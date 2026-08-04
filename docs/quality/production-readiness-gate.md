# Production-readiness gate

## Implemented locally

- production/staging configuration preflight with automated regression tests;
- immutable single application image for API, worker, web and migrations;
- non-root runtime plus dropped Linux capabilities, no-new-privileges, init,
  bounded logs, graceful stop windows and API/web health checks;
- GHCR publication only after successful CI, with SBOM and provenance;
- weekly dependency, GitHub Actions and Docker update monitoring;
- high-severity production dependency audit in CI;
- HTTPS-oriented web security headers and hidden framework signature;
- V1 safety switch that keeps monthly charge automation active but prevents
  automatic WhatsApp schedule creation/enqueueing;
- staging and production environment templates containing no real secret;
- launch, smoke, backup, recovery, rollback and incident runbook.

## External evidence still required

Local tests cannot approve a production launch. Attach evidence for managed
PostgreSQL restore, Redis TLS, R2 restore/versioning, Sentry alerts, Resend real
delivery/webhook, Cloudflare HTTPS/rate limits, VPS restart behavior, Mercado
Pago OAuth sandbox end-to-end and finally Mercado Pago Live. Each item remains blocking until its
real provider journey has been observed.

## Local evidence — 2026-08-02

- isolated clean PostgreSQL: all 27 migrations applied successfully;
- existing PostgreSQL: second deploy reported no pending migration;
- database integration: 7/7 passed;
- worker integration: 20/20 passed, including concurrency, restart, enrollment
  cancellation, configurable charge time and disabled V1 message automation;
- web regression: 22/22 passed, including the runtime API proxy and safe upstream
  failure response;
- monorepo typecheck, lint, unit tests, production build and compiled API/worker
  runtime tests passed;
- production dependency audit: no known vulnerability at high severity or above;
- production and local Docker Compose configurations validated;
- production Docker image built from a 2.51 MB filtered context;
- image smoke: Next runtime answered `/login` with `200` as UID/GID `mensaly`
  (non-root) and returned frame, MIME and permissions security headers.
