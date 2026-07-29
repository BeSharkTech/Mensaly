# Local demo seed

The demo seed creates one deterministic owner, company, plan, student, guardian,
relationship and enrollment for local development. Running it repeatedly updates
the same records and resets the demo credential password.

It is intentionally guarded:

- `DEMO_SEED_ENABLED` must be exactly `true`;
- `NODE_ENV=production` is rejected;
- only `localhost` and `127.0.0.1` database hosts are accepted;
- the password must contain 12 to 128 characters;
- an existing non-demo account cannot be taken over by the demo email.

Example in PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://mensaly_test:mensaly_test_local@localhost:55432/mensaly_test?schema=public"
$env:DEMO_SEED_ENABLED = "true"
$env:DEMO_SEED_EMAIL = "owner.demo@mensaly.local"
$env:DEMO_SEED_PASSWORD = "<choose-a-local-password-with-12-or-more-characters>"
$env:NODE_ENV = "development"
pnpm db:seed:demo
```

The command prints the normalized login email and organization ID. Do not store
the chosen password in the repository, shared logs or screenshots.
