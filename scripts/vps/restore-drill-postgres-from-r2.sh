#!/usr/bin/env bash
set -euo pipefail

# Downloads the latest R2 backup, verifies its checksum, restores it into a
# disposable database and runs read-only integrity checks. Production is never
# overwritten; the temporary database is removed even when a check fails.
ENV_FILE="${MENSALY_ENV_FILE:-/opt/mensaly/.env.production}"
STACK_DIR="${MENSALY_STACK_DIR:-/opt/mensaly}"
COMPOSE_FILE="${MENSALY_COMPOSE_FILE:-$STACK_DIR/infra/docker/compose.single-vps.yaml}"
BACKUP_PREFIX="${BACKUP_PREFIX:-backups/postgres}"
RCLONE_IMAGE="${RCLONE_IMAGE:-rclone/rclone:1.68}"
RCLONE_PROVIDER="${RCLONE_PROVIDER:-Cloudflare}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"

fail() {
  echo "PostgreSQL restore drill failed: $1" >&2
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

[[ "${ALLOW_RESTORE_DRILL:-}" == "YES" ]] || fail "set ALLOW_RESTORE_DRILL=YES explicitly"
[[ -r "$ENV_FILE" ]] || fail "environment file is not readable: $ENV_FILE"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

[[ "$BACKUP_PREFIX" =~ ^[A-Za-z0-9/_-]+$ ]] || fail "BACKUP_PREFIX contains unsupported characters"

for required_name in POSTGRES_USER POSTGRES_DB S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  [[ -n "${!required_name:-}" ]] || fail "$required_name is required"
done

umask 077
restore_tmp_dir="$(mktemp -d -t mensaly-restore-XXXXXXXX)"
restore_database="mensaly_restore_drill_$(date -u +%Y%m%d%H%M%S)"
database_created=false
restore_mount_dir="$(docker_bind_source "$restore_tmp_dir")"

cleanup() {
  if [[ "$database_created" == "true" && "$restore_database" == mensaly_restore_drill_* ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
      exec -T "$POSTGRES_SERVICE" dropdb --if-exists --force --username "$POSTGRES_USER" "$restore_database" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$restore_tmp_dir"
}
trap cleanup EXIT

rclone_env=(
  -e RCLONE_CONFIG_MENSALY_TYPE=s3
  -e "RCLONE_CONFIG_MENSALY_PROVIDER=$RCLONE_PROVIDER"
  -e "RCLONE_CONFIG_MENSALY_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID"
  -e "RCLONE_CONFIG_MENSALY_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY"
  -e "RCLONE_CONFIG_MENSALY_ENDPOINT=$S3_ENDPOINT"
)

latest_archive="$(docker_run --rm "${rclone_env[@]}" "$RCLONE_IMAGE" \
  lsf "mensaly:$S3_BUCKET/$BACKUP_PREFIX" --files-only --include "*.dump" | sort | tail -n 1)"
[[ -n "$latest_archive" ]] || fail "no .dump archive exists in R2"
[[ "$latest_archive" =~ ^mensaly-[0-9T-]+Z\.dump$ ]] || fail "latest archive name is invalid"

docker_run --rm \
  "${rclone_env[@]}" \
  -v "$restore_mount_dir:/restore" \
  "$RCLONE_IMAGE" copyto "mensaly:$S3_BUCKET/$BACKUP_PREFIX/$latest_archive" "/restore/$latest_archive"
docker_run --rm \
  "${rclone_env[@]}" \
  -v "$restore_mount_dir:/restore" \
  "$RCLONE_IMAGE" copyto "mensaly:$S3_BUCKET/$BACKUP_PREFIX/${latest_archive}.sha256" "/restore/${latest_archive}.sha256"

(
  cd "$restore_tmp_dir"
  sha256sum --check "${latest_archive}.sha256"
)

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  exec -T "$POSTGRES_SERVICE" createdb --template=template0 --username "$POSTGRES_USER" "$restore_database"
database_created=true

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  exec -T "$POSTGRES_SERVICE" pg_restore \
    --exit-on-error \
    --no-owner \
    --no-privileges \
    --username "$POSTGRES_USER" \
    --dbname "$restore_database" < "$restore_tmp_dir/$latest_archive"

integrity_result="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  exec -T "$POSTGRES_SERVICE" psql --username "$POSTGRES_USER" --dbname "$restore_database" \
    --tuples-only --no-align --set ON_ERROR_STOP=1 \
    --command 'SELECT (SELECT count(*) FROM "organization"), (SELECT count(*) FROM "charge"), (SELECT count(*) FROM "payment"), (SELECT count(*) FROM "audit_log"), (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL);')"

[[ "$integrity_result" =~ ^[0-9]+\|[0-9]+\|[0-9]+\|[0-9]+\|[1-9][0-9]*$ ]] \
  || fail "restored database integrity query returned an invalid result"

echo "Restore drill passed for $latest_archive"
echo "Verified counts (organizations|charges|payments|audit_logs|migrations): $integrity_result"
