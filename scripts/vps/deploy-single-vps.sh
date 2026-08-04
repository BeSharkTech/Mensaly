#!/usr/bin/env bash
set -euo pipefail

# One-command first-customer deployment. The only mutable input is the secret
# environment file kept outside Git. Run as root so the backup schedule can be
# installed with root-owned permissions.
STACK_DIR="${MENSALY_STACK_DIR:-/opt/mensaly}"
ENV_FILE="${MENSALY_ENV_FILE:-$STACK_DIR/.env.production}"
COMPOSE_FILE="$STACK_DIR/infra/docker/compose.single-vps.yaml"

fail() {
  echo "Mensaly deployment failed: $1" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || fail "run as root (sudo $0)"
[[ -r "$ENV_FILE" ]] || fail "environment file is not readable: $ENV_FILE"
[[ -f "$COMPOSE_FILE" ]] || fail "Compose file was not found: $COMPOSE_FILE"

permissions="$(stat -c '%a' "$ENV_FILE")"
[[ "$permissions" == "600" ]] || fail "$ENV_FILE must have permissions 600 (current: $permissions)"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
[[ -n "${MENSALY_IMAGE:-}" ]] || fail "MENSALY_IMAGE is required"

docker pull "$MENSALY_IMAGE"
docker run --rm --env-file "$ENV_FILE" --entrypoint pnpm "$MENSALY_IMAGE" \
  production:check:single-vps

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet

if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --status running --services \
  | grep -Fx postgres >/dev/null; then
  echo "Creating verified pre-deploy PostgreSQL backup..."
  MENSALY_ENV_FILE="$ENV_FILE" MENSALY_STACK_DIR="$STACK_DIR" \
    "$STACK_DIR/scripts/vps/backup-postgres-to-r2.sh"
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --wait --remove-orphans

echo "Proving off-VPS backup and isolated restore..."
MENSALY_ENV_FILE="$ENV_FILE" MENSALY_STACK_DIR="$STACK_DIR" \
  "$STACK_DIR/scripts/vps/backup-postgres-to-r2.sh"
ALLOW_RESTORE_DRILL=YES MENSALY_ENV_FILE="$ENV_FILE" MENSALY_STACK_DIR="$STACK_DIR" \
  "$STACK_DIR/scripts/vps/restore-drill-postgres-from-r2.sh"

MENSALY_STACK_DIR="$STACK_DIR" "$STACK_DIR/scripts/vps/install-backup-cron.sh"

curl --fail --silent --show-error --max-time 15 --retry 12 --retry-delay 5 --retry-all-errors \
  "${PUBLIC_API_URL%/}/api/v1/health/ready" >/dev/null
curl --fail --silent --show-error --max-time 15 --retry 12 --retry-delay 5 --retry-all-errors \
  "${PUBLIC_WEB_URL%/}/login" >/dev/null

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
echo "Mensaly deployment passed preflight, migrations, health checks and backup scheduling."
