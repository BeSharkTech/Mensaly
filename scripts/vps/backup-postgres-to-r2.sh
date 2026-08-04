#!/usr/bin/env bash
set -euo pipefail

# Creates a verified PostgreSQL custom-format archive and stores it outside the
# VPS in the configured R2 bucket. No credential value is printed.
ENV_FILE="${MENSALY_ENV_FILE:-/opt/mensaly/.env.production}"
STACK_DIR="${MENSALY_STACK_DIR:-/opt/mensaly}"
COMPOSE_FILE="${MENSALY_COMPOSE_FILE:-$STACK_DIR/infra/docker/compose.single-vps.yaml}"
BACKUP_PREFIX="${BACKUP_PREFIX:-backups/postgres}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
RCLONE_IMAGE="${RCLONE_IMAGE:-rclone/rclone:1.68}"
RCLONE_PROVIDER="${RCLONE_PROVIDER:-Cloudflare}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"

fail() {
  echo "PostgreSQL backup failed: $1" >&2
  exit 1
}

docker_bind_source() {
  if command -v cygpath >/dev/null 2>&1; then cygpath --windows "$1"
  else printf '%s\n' "$1"
  fi
}

docker_run() {
  MSYS_NO_PATHCONV=1 docker run "$@"
}

[[ -r "$ENV_FILE" ]] || fail "environment file is not readable: $ENV_FILE"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

[[ "$BACKUP_PREFIX" =~ ^[A-Za-z0-9/_-]+$ ]] || fail "BACKUP_PREFIX contains unsupported characters"
[[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] || fail "BACKUP_RETENTION_DAYS must be an integer"
(( BACKUP_RETENTION_DAYS >= 7 )) || fail "BACKUP_RETENTION_DAYS must be at least 7"

for required_name in POSTGRES_USER POSTGRES_DB S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  [[ -n "${!required_name:-}" ]] || fail "$required_name is required"
done

umask 077
backup_tmp_dir="$(mktemp -d -t mensaly-backup-XXXXXXXX)"
cleanup() { rm -rf -- "$backup_tmp_dir"; }
trap cleanup EXIT

stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
archive_name="mensaly-${stamp}.dump"
archive_path="$backup_tmp_dir/$archive_name"
object_path="$BACKUP_PREFIX/$archive_name"
backup_mount_dir="$(docker_bind_source "$backup_tmp_dir")"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  exec -T "$POSTGRES_SERVICE" pg_dump \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges \
    --username "$POSTGRES_USER" \
    "$POSTGRES_DB" > "$archive_path"

[[ -s "$archive_path" ]] || fail "pg_dump produced an empty archive"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  exec -T "$POSTGRES_SERVICE" pg_restore --list < "$archive_path" > /dev/null

(
  cd "$backup_tmp_dir"
  sha256sum "$archive_name" > "${archive_name}.sha256"
)

rclone_env=(
  -e RCLONE_CONFIG_MENSALY_TYPE=s3
  -e "RCLONE_CONFIG_MENSALY_PROVIDER=$RCLONE_PROVIDER"
  -e "RCLONE_CONFIG_MENSALY_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID"
  -e "RCLONE_CONFIG_MENSALY_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY"
  -e "RCLONE_CONFIG_MENSALY_ENDPOINT=$S3_ENDPOINT"
)

docker_run --rm \
  "${rclone_env[@]}" \
  "$RCLONE_IMAGE" mkdir "mensaly:$S3_BUCKET/$BACKUP_PREFIX"

docker_run --rm \
  "${rclone_env[@]}" \
  -v "$backup_mount_dir:/backup:ro" \
  "$RCLONE_IMAGE" copyto "/backup/$archive_name" "mensaly:$S3_BUCKET/$object_path"

docker_run --rm \
  "${rclone_env[@]}" \
  -v "$backup_mount_dir:/backup:ro" \
  "$RCLONE_IMAGE" copyto "/backup/${archive_name}.sha256" "mensaly:$S3_BUCKET/${object_path}.sha256"

docker_run --rm \
  "${rclone_env[@]}" \
  "$RCLONE_IMAGE" lsf "mensaly:$S3_BUCKET/$object_path" --files-only | grep -Fx "$archive_name" > /dev/null

docker_run --rm \
  "${rclone_env[@]}" \
  "$RCLONE_IMAGE" delete "mensaly:$S3_BUCKET/$BACKUP_PREFIX" \
    --min-age "${BACKUP_RETENTION_DAYS}d" \
    --include "*.dump" \
    --include "*.dump.sha256"

echo "PostgreSQL backup verified and uploaded: $object_path"
echo "Retention applied: ${BACKUP_RETENTION_DAYS} days"
