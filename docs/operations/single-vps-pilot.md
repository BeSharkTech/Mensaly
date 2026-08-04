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

1. Use the immutable `ghcr.io/besharktech/mensaly:sha-<commit>` image produced
   by the approved CI run. If the GHCR package is private, authenticate the VPS
   once with a GitHub token that has only `read:packages` permission:

   ```bash
   docker login ghcr.io -u YOUR_GITHUB_USER
   ```
2. Generate `/opt/mensaly/.env.production` once. This creates the database,
   Redis and encryption secrets on the VPS and pins the current commit image:

   ```bash
   cd /opt/mensaly
   ./scripts/vps/prepare-production-env.sh
   ```

3. Edit only the remaining `REPLACE_WITH` provider values (R2, Sentry, Resend
   and Mercado Pago). Keep the generated values unchanged. The file is already
   created with owner-only permissions (`600`) and must never enter Git.

4. Open Lightsail ports 80 and 443. Keep PostgreSQL, Redis and the Next/API
   ports private.
5. Point both `app.mensaly.online` and `api.mensaly.online` to the VPS static
   IP and wait for DNS before starting Caddy. The OAuth callback uses `app` to
   preserve the authenticated browser session; Mercado Pago webhooks use `api`.
6. Validate the secret environment file without printing values:

   ```bash
   cd /opt/mensaly
   pnpm production:check:single-vps -- --env-file=/opt/mensaly/.env.production
   ```

7. Deploy, migrate, install the backup schedule and verify both public health
   endpoints with one command:

   ```bash
   sudo /opt/mensaly/scripts/vps/deploy-single-vps.sh
   ```

   On upgrades, the deploy script creates and verifies an off-VPS backup before
   applying migrations. After every deployment it also creates a fresh backup,
   performs an isolated restore drill and installs the daily schedule. A backup
   or restoration failure blocks delivery.

## Required backup job

After R2 has been configured, install the root-owned cron definition once:

```bash
sudo /opt/mensaly/scripts/vps/install-backup-cron.sh
```

The job creates a PostgreSQL custom archive, validates it with `pg_restore`,
uploads the archive and its SHA-256 checksum, verifies the remote object and
removes objects older than `BACKUP_RETENTION_DAYS` (minimum 7 days).
The R2 key therefore needs list/read/write/delete access only to the configured
bucket. If the bucket does not exist, the first run can create it only when the
key also has bucket-creation permission; otherwise create the private bucket in
Cloudflare before deployment.

Run and prove the full cycle before opening the pilot:

```bash
/opt/mensaly/scripts/vps/backup-postgres-to-r2.sh
ALLOW_RESTORE_DRILL=YES /opt/mensaly/scripts/vps/restore-drill-postgres-from-r2.sh
```

The drill downloads the latest backup, validates its checksum, restores it into
a uniquely named disposable database, checks core tables and migrations, then
removes only that disposable database. It never overwrites production.

## Failure and recovery

- A VPS loss causes downtime until a replacement VPS starts and the latest R2
  dump is restored.
- Alert if `/opt/mensaly/backup.log` does not contain a successful upload in 26
  hours or if the restore drill fails.
- Never use `docker compose down --volumes` in this profile.
- Move PostgreSQL to managed infrastructure before accepting multiple schools
  or a strict recovery-time commitment.
