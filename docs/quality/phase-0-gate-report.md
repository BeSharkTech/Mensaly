# Phase 0 stabilization gate

**Date:** 2026-07-30
**Environment:** local Next.js web, compiled/development API, PostgreSQL 17 and
Redis 7.2 isolated test services

## Functional evidence

The complete company-owner journey was exercised through the browser:

1. account registration with a six-character password;
2. onboarding and business configuration;
3. plan creation and dashboard access;
4. logout, login and authenticated session restoration;
5. guardian, student and enrollment creation;
6. product/stock and event creation;
7. internal broadcast creation and queue registration for one recipient;
8. monthly charge generation, repeated idempotent generation, manual cash
   payment and confirmed payment history.

All created records were reloaded from the API/database and rendered again by
the interface. Expected validation failures remained visible without breaking
the page. No browser console error remained after the final financial flow.

The message result in this phase is only an internal queued record. It is not
evidence of WhatsApp delivery. Baileys and external delivery states remain in
the communication phase.

## Defects corrected during the gate

- native date and date-time inputs now update React state reliably;
- date-only values no longer shift to the previous day in the São Paulo
  timezone;
- the financial generation and manual-payment buttons now call the backend,
  block duplicate actions and surface failures;
- charge responses now include the related plan required by the web contract;
- the web API adapter preserves pagination metadata and supports both frozen v1
  response shapes;
- generated Next.js recovery directories no longer enter lint;
- frontend test timeouts tolerate normal monorepo/CI contention;
- the frozen OpenAPI document was regenerated after the student birth-date
  contract correction.

## Automated gate

| Check | Result |
| --- | --- |
| Web functional tests | 8/8 |
| API tests | 24/24 |
| Monorepo test tasks | 9/9 |
| Database integration | 7/7 |
| Worker integration | 16/16 |
| Typecheck | 9/9 |
| Lint | 10/10 |
| Production build | 9/9 |
| Compiled runtime | API 1/1 and worker 1/1 |
| Migrations | 19/19 on an empty database; second deploy had no pending migration |
| Demo seed | two idempotent runs; real login and tenant-derived organization passed |
| Dependency audit | no known production vulnerabilities |
| Diff whitespace check | passed |

The integration suites were run against a disposable PostgreSQL instance whose
database was named `mensaly_test`, as required by their destructive-test safety
guard. The container was removed after the run.

## Security and failure review

- Organization identity continues to come only from the authenticated session.
- Cross-company access, invalid identifiers, rate limits, session revocation,
  audit metadata and financial concurrency/idempotency are covered by the API
  suite.
- Financial generation is serialized and can be repeated without duplicate
  charges.
- Manual payment uses a unique idempotency key, requires explicit confirmation
  and refreshes server state after conflicts.
- Errors retain the stable error envelope and correlation ID.
- Demo data is forbidden in production, limited to local database hosts and
  cannot take over a non-demo account.
- Provider outages, uncertain WhatsApp delivery and automatic resend remain
  explicitly outside Phase 0; no external delivery was claimed or enabled.

## Operational boundary

The local Phase 0 gate is approved. Managed staging deployment, production
backups/restore, S3/R2, centralized observability and external providers remain
gates of later phases. The v1 web adapter intentionally supports the two
already-frozen success shapes; new endpoints must use `{ data, meta? }`, and
removing the legacy direct shape requires a versioned compatibility change.
