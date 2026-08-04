#!/usr/bin/env bash
set -euo pipefail

STACK_DIR="${MENSALY_STACK_DIR:-/opt/mensaly}"
CRON_FILE="/etc/cron.d/mensaly-postgres-backup"

[[ "$(id -u)" -eq 0 ]] || {
  echo "Run this installer as root (for example: sudo scripts/vps/install-backup-cron.sh)." >&2
  exit 1
}
[[ "$STACK_DIR" =~ ^/[A-Za-z0-9/._-]+$ ]] || {
  echo "Stack path contains unsupported characters: $STACK_DIR" >&2
  exit 1
}
DEPLOY_USER="${MENSALY_DEPLOY_USER:-$(stat -c '%U' "$STACK_DIR")}"
id "$DEPLOY_USER" >/dev/null 2>&1 || {
  echo "Deploy user does not exist: $DEPLOY_USER" >&2
  exit 1
}
[[ -x "$STACK_DIR/scripts/vps/backup-postgres-to-r2.sh" ]] || {
  echo "Backup script is missing or not executable." >&2
  exit 1
}

cron_tmp="$(mktemp)"
trap 'rm -f -- "$cron_tmp"' EXIT
printf '%s\n' \
  'SHELL=/bin/bash' \
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
  "15 3 * * * $DEPLOY_USER MENSALY_STACK_DIR=$STACK_DIR $STACK_DIR/scripts/vps/backup-postgres-to-r2.sh >> $STACK_DIR/backup.log 2>&1" \
  > "$cron_tmp"
install -o root -g root -m 0644 "$cron_tmp" "$CRON_FILE"

echo "Installed daily PostgreSQL backup schedule at 03:15 UTC: $CRON_FILE"
