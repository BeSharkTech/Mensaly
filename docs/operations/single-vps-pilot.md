# Pilot deployment: single VPS

This profile is intentionally for the first-customer pilot. PostgreSQL and
Redis run in private containers on the same VPS as the application. It is less
resilient than managed database infrastructure and must be migrated before
multi-customer scale.

## What it protects

- PostgreSQL and Redis have no published host ports.
- Docker volumes survive container restarts and upgrades.
- Redis uses AOF and `noeviction`, preserving BullMQ job integrity.
- Caddy is the only public service (ports 80 and 443).
- API, worker and web run as non-root with dropped Linux capabilities.
- PostgreSQL backups are exported daily to Cloudflare R2.

## Deploy

1. Build the approved image as `mensaly:production`.
2. Create `/opt/mensaly/.env.production` from
   `infra/env/single-vps.env.example`; do not put it in Git.
3. Set owner-only permissions:

   ```bash
   chmod 600 /opt/mensaly/.env.production
   ```

4. Open Lightsail ports 80 and 443. Keep PostgreSQL, Redis and the Next/API
   ports private.
5. Point `app.mensaly.online` to the VPS static IP and wait for DNS before
   starting Caddy.
6. Start and verify:

   ```bash
   docker compose --env-file /opt/mensaly/.env.production \
     -f /opt/mensaly/infra/docker/compose.single-vps.yaml up -d --wait
   docker compose --env-file /opt/mensaly/.env.production \
     -f /opt/mensaly/infra/docker/compose.single-vps.yaml ps
   ```

## Required backup job

After R2 has been configured, schedule the following as the `ubuntu` user:

```cron
15 3 * * * /opt/mensaly/scripts/vps/backup-postgres-to-r2.sh >> /opt/mensaly/backup.log 2>&1
```

Run the script once manually, verify the object in R2, and perform a restore
drill into an isolated database before calling the pilot recoverable.

## Failure and recovery

- A VPS loss causes downtime until a replacement VPS starts and the latest R2
  dump is restored.
- Never use `docker compose down --volumes` in this profile.
- Move PostgreSQL to managed infrastructure before accepting multiple schools
  or a strict recovery-time commitment.
