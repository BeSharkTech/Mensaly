#!/usr/bin/env bash
set -euo pipefail

# Creates the production environment file once, generating all Mensaly-owned
# secrets locally on the VPS. Provider credentials remain explicit placeholders
# for the operator to fill in without sharing them through Git or chat.
STACK_DIR="${MENSALY_STACK_DIR:-/opt/mensaly}"
TEMPLATE="$STACK_DIR/infra/env/single-vps.env.example"
TARGET="${MENSALY_ENV_FILE:-$STACK_DIR/.env.production}"

[[ -r "$TEMPLATE" ]] || {
  echo "Environment template was not found: $TEMPLATE" >&2
  exit 1
}
[[ ! -e "$TARGET" ]] || {
  echo "Refusing to overwrite existing environment file: $TARGET" >&2
  exit 1
}

commit_sha="$(git -C "$STACK_DIR" rev-parse HEAD)"
[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Could not resolve an immutable Git commit." >&2
  exit 1
}

postgres_password="$(openssl rand -hex 32)"
redis_password="$(openssl rand -hex 32)"
email_encryption_key="$(openssl rand -base64 32 | tr -d '\n')"
payment_encryption_key="$(openssl rand -base64 32 | tr -d '\n')"
payment_link_secret="$(openssl rand -base64 32 | tr -d '\n')"

umask 077
cp "$TEMPLATE" "$TARGET"
sed -i 's/\r$//' "$TARGET"
sed -i \
  -e "s|REPLACE_WITH_LONG_RANDOM_DATABASE_PASSWORD|$postgres_password|" \
  -e "s|REPLACE_WITH_LONG_RANDOM_REDIS_PASSWORD|$redis_password|" \
  -e "s|REPLACE_WITH_32_BYTE_BASE64_KEY|$email_encryption_key|" \
  -e "s|REPLACE_WITH_DIFFERENT_32_BYTE_BASE64_KEY|$payment_encryption_key|" \
  -e "s|REPLACE_WITH_A_DIFFERENT_32_BYTE_BASE64_KEY|$payment_link_secret|" \
  -e "s|sha-REPLACE_WITH_APPROVED_40_CHARACTER_COMMIT|sha-$commit_sha|" \
  "$TARGET"
chmod 600 "$TARGET"

echo "Created $TARGET with generated internal secrets and immutable image tag."
echo "Fill only the remaining REPLACE_WITH provider credentials, then run the deployment script."
