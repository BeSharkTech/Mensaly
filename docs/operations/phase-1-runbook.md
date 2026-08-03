# Phase 1 — platform operations runbook

## Deployment boundary

`infra/docker/compose.app.yaml` runs only API, worker, web and the one-shot
migration job. PostgreSQL and Redis are deliberately external managed services;
they are not production Docker volumes. Deploy with secrets injected by the
platform secret manager, never by committing an environment file.

Required production controls:

- PostgreSQL automatic backup/PITR enabled and restore drill recorded;
- Redis with TLS, authentication, eviction policy suitable for queues and a
  private network endpoint;
- S3/R2 bucket private, versioning enabled where available, dedicated least-
  privilege access key (`GetObject`, `PutObject`, `DeleteObject`, `HeadBucket`);
- HTTPS terminated by a managed proxy/load balancer, with `CORS_ORIGINS` set to
  the exact HTTPS web origin and `TRUST_PROXY_HOPS` matching that proxy;
- Sentry DSN stored as a secret. No DSN is safe for local development, but
  staging and production must alert on API exceptions and readiness failures.

## Controlled release

1. CI must pass build, typecheck, lint, unit/integration/runtime tests and
   compose validation.
2. Apply the exact commit to staging with `docker compose --env-file <secret-file>
   -f infra/docker/compose.app.yaml up -d --build`.
3. Wait for the migration job to finish successfully and API health
   `/api/v1/health/ready` to be ready.
4. Sign in as a platform administrator and verify
   `/api/v1/health/platform`; confirm database, Redis and storage are ready.
5. Run the real onboarding, student, plan, enrollment and charge smoke flow.
6. Promote the same immutable image/commit to production only after the staged
   evidence is recorded. Roll back the application image only; do not roll back
   an already-applied database migration without a specific recovery plan.

## Incident response

- A degraded readiness check stops new rollout traffic; investigate the named
  dependency using the correlation ID from API logs.
- A failed file upload remains auditable and returns a retry-safe error. Do not
  write files to a container filesystem as an emergency workaround.
- A worker failure is restarted by Docker; inspect queue/dead-letter state
  before manually reprocessing anything.
- Repeated provider timeouts or duplicate webhooks require idempotent recovery,
  never blind automatic resends.
