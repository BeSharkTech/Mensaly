# Mensaly production launch

This runbook is the release authority for the first production version. The V1
keeps WhatsApp semi-automatic: the owner reviews each personalized message and
opens WhatsApp manually. `MESSAGE_AUTOMATION_ENABLED=false` is mandatory until
a real production provider passes its own delivery gate.

## 1. Services required before the VPS

Create separate staging and production resources:

- managed PostgreSQL with TLS, automatic daily backups, PITR and a documented
  retention period;
- managed Redis with TLS/authentication, persistence suitable for BullMQ and no
  public unrestricted endpoint;
- private Cloudflare R2 bucket with a dedicated least-privilege key and object
  versioning/lifecycle policy;
- Sentry project with alerts for new API errors and readiness failures;
- Resend domain, API key and signed webhook (already represented by mandatory
  environment variables).

Do not reuse development credentials. Keep the real environment files outside
the repository and restrict their filesystem permissions to the deploy user.

## 2. Validate configuration without printing secrets

Start from `infra/env/staging.env.example`. Replace every placeholder in a
secret `.env` outside the repository, load it into the process and run:

```powershell
pnpm production:check:staging
```

The check rejects local endpoints, HTTP public URLs, Redis without TLS,
PostgreSQL without `sslmode`, missing observability, invalid CORS, placeholder
secrets, reused encryption keys and automatic WhatsApp delivery. The live gate
also requires live Stripe credentials:

```powershell
pnpm production:check:live
```

Never paste the command output together with the environment file into a ticket
or chat. The checker prints field names and reasons, never values.

## 3. Build and release artifact

Every approved push to `main` first passes CI. Only a successful CI run publishes
an SBOM/provenance-enabled image to GHCR. Deploy the immutable `sha-<commit>` tag
shown in the workflow summary. The `staging` tag is convenient for inspection
but is not a production release identifier.

Before promotion, record:

- commit SHA and image digest;
- CI URL and result;
- migration list included in the image;
- operator, start/end time and rollback owner.

## 4. Staging deployment and smoke gate

On the future host, authenticate to GHCR and run the exact approved image:

```bash
docker compose --env-file /run/secrets/mensaly-staging.env \
  -f infra/docker/compose.app.yaml pull
docker compose --env-file /run/secrets/mensaly-staging.env \
  -f infra/docker/compose.app.yaml up -d --no-build
```

The one-shot migration must finish before the API starts. Confirm:

1. `/api/v1/health/live` returns `200`;
2. `/api/v1/health/ready` reports database and Redis ready;
3. authenticated `/api/v1/health/platform` reports database, Redis and storage
   ready and observability configured;
4. web response contains the security headers and login renders over HTTPS;
5. create account, verify email, log in, finish onboarding, create plan,
   responsible party, student and enrollment;
6. run the charge scheduler at a controlled time, confirm exactly one charge,
   open checkout and complete a Stripe test payment;
7. verify duplicate webhook delivery does not duplicate the payment;
8. reset a password through a real Resend email;
9. create a manual message and confirm tags `[aluno]`, `[responsavel]` and
   `[link]` resolve without any worker-generated WhatsApp send;
10. restart API and worker and repeat readiness plus pending-job inspection.

Any failure blocks promotion.

## 5. Backup and recovery gate

Before production traffic, restore the latest PostgreSQL backup into an isolated
database, run migrations and execute read-only counts for organizations,
students, enrollments, charges, payments, audit logs and webhook inbox rows.
Record duration and evidence. Validate that an R2 object can be restored from a
previous version and that Redis loss does not erase PostgreSQL business state.

The application image can be rolled back to the prior immutable tag. Database
migrations are forward-only during routine incidents: never run a destructive
rollback against production without a migration-specific recovery plan.

## 6. Edge and alerts on the VPS (penultimate activation)

- expose only ports 80/443 through Cloudflare; database and Redis stay private;
- terminate HTTPS at Cloudflare/reverse proxy and redirect all HTTP to HTTPS;
- set HSTS after HTTPS is verified and keep the API/web container ports bound to
  loopback;
- configure edge rate limits for login, registration, password reset, public
  forms, payment-link creation and webhooks;
- alert on API readiness failure, container restart loops, disk pressure, queue
  growth, dead-letter jobs, email failures and webhook failures;
- enable automatic security updates and firewall SSH to the operator network.

## 7. Stripe Live (final activation)

After every previous gate passes, replace only the four Stripe test values with
live values, register the production webhook URL, set
`STRIPE_CONNECT_MODE=live`, run `pnpm production:check:live`, deploy the same
approved image and complete one low-value real transaction. Confirm provider
payment, signed webhook, Mensaly status, audit record and connected-account
balance before opening customer access.

## 8. Incident stop conditions

Immediately stop new traffic or financial actions when tenant isolation is in
doubt, webhook signatures fail repeatedly, a payment cannot be reconciled, the
database backup is unavailable, or delivery state is uncertain. Preserve logs
and correlation IDs. Do not resend messages or replay financial jobs blindly.
