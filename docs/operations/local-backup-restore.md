# Local PostgreSQL backup and restore

These commands require PostgreSQL client tools compatible with the server.
Never restore with `--clean` into a shared or production database.

## Backup

```powershell
$backupPath = Join-Path (Get-Location) "mensaly-local.backup"
pg_dump --dbname="$env:DATABASE_URL" --format=custom --no-owner --file="$backupPath"
pg_restore --list "$backupPath"
```

The final command must list the archive without errors. Store the archive
outside the repository; database backups may contain personal data and secrets.

## Restore into a disposable local database

Set `RESTORE_DATABASE_URL` to a different empty local database. Verify the
hostname before running the destructive restore:

```powershell
$restoreUri = [System.Uri]$env:RESTORE_DATABASE_URL
if ($restoreUri.Host -notin @("localhost", "127.0.0.1")) {
  throw "Restore is restricted to a local database"
}
pg_restore --dbname="$env:RESTORE_DATABASE_URL" --clean --if-exists --no-owner "mensaly-local.backup"
$originalDatabaseUrl = $env:DATABASE_URL
$env:DATABASE_URL = $env:RESTORE_DATABASE_URL
pnpm db:migrate:deploy
pnpm --filter @mensaly/database test:integration
$env:DATABASE_URL = $originalDatabaseUrl
```

The restore is accepted only after migrations report no pending changes and
the database integration tests pass.
