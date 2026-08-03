#!/usr/bin/env bash
set -euo pipefail

# Run from the VPS with cron. The environment file must be outside Git and
# readable only by the deploy user. The same R2 credentials are used for files.
ENV_FILE="${MENSALY_ENV_FILE:-/opt/mensaly/.env.production}"
STACK_DIR="${MENSALY_STACK_DIR:-/opt/mensaly}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OBJECT="backups/postgres/${STAMP}.sql.gz"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Environment file is not readable: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

docker compose --env-file "$ENV_FILE" -f "$STACK_DIR/infra/docker/compose.single-vps.yaml" \
  exec -T postgres pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip -9 \
  | docker run --rm -i \
      -e RCLONE_CONFIG_MENSALY_TYPE=s3 \
      -e RCLONE_CONFIG_MENSALY_PROVIDER=Cloudflare \
      -e RCLONE_CONFIG_MENSALY_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
      -e RCLONE_CONFIG_MENSALY_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
      -e RCLONE_CONFIG_MENSALY_ENDPOINT="$S3_ENDPOINT" \
      rclone/rclone:1.68 rcat "mensaly:${S3_BUCKET}/${OBJECT}"

echo "Uploaded PostgreSQL backup: ${OBJECT}"
