# Backend hardening audit — 2026-07-29

## Scope

Complete review of the API, PostgreSQL schema and migrations, Redis/BullMQ
runtime, scheduler, message worker, webhook inbox, local file storage,
administrative endpoints, dashboards, audit trail and frozen OpenAPI contract.

## Module 1 — authentication, sessions and browser security

- Passwords and all bearer-like tokens remain stored only as hashes.
- Expired or invalid sessions are now removed when encountered.
- Unsafe cookie-authenticated browser requests reject unapproved origins.
- API responses now include `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
  `Referrer-Policy: no-referrer`.
- Registration, verification, login throttling, password reset, session
  revocation, blocked accounts and owner-derived organization context were
  exercised by the API suite.

## Module 2 — operational data and tenant isolation

- Plan, student, guardian and enrollment writes now commit atomically with
  their audit record.
- Composite database foreign keys bind students, guardians, plans,
  enrollments and links to the same `organizationId`. Cross-tenant writes are
  rejected even if application checks regress.
- Guardian links are unique and idempotent.
- UUIDs, normalized phones and tax identifiers, integer bounds, discounts and
  enrollment date ranges are validated.
- Search was implemented consistently for plans, students, guardians and
  enrollments.

## Module 3 — finance and concurrency

- Monthly generation locks both the generation key and the enrollment rows it
  reads, preventing stale charges during concurrent changes.
- Charge generation and payment transitions remain idempotent and audited in a
  transaction.
- Reference months before 2000 and values that would overflow PostgreSQL
  integers are rejected.
- Reversing a confirmed payment reopens the charge; the scheduler safely
  recreates automated reminder work cancelled because the charge had been
  paid.
- Concurrent charge generation, payment creation and confirmation are covered
  by integration tests.

## Module 4 — reminders, queues, webhooks and files

- All message resource IDs are parsed as UUIDs.
- Provider and webhook errors are bounded to database column sizes before
  persistence.
- Webhook payloads are bounded to 32 levels and 10,000 nodes before canonical
  comparison or storage.
- Delivery still revalidates tenant, charge, rule, recipient block, link and
  daily-limit conditions before calling the adapter.
- File upload validates size, signature and type; download verifies size and
  SHA-256; storage keys remain organization-scoped; incomplete deletes are
  retryable.
- File mutations now carry request correlation, IP and user-agent metadata in
  audit records.

## Module 5 — contract, administration and infrastructure

- Every protected OpenAPI operation declares the `mensaly_session` cookie
  scheme. A contract test invokes every protected operation without a cookie
  and requires authentication to fail before input processing.
- Organization status changes now serialize concurrent administrators and
  commit the status and correlated audit entry in one transaction.
- All path IDs are parsed as UUIDs.
- The executable API example uses the actual development port, `3001`.
- `TRUST_PROXY_HOPS` explicitly controls reverse-proxy trust; the secure
  default is zero.

## Verification gates

- Production dependency audit: no known vulnerabilities at moderate severity
  or above.
- Static scan: no TODO, FIXME, HACK, `ts-ignore`, blanket ESLint suppression or
  explicit `any` markers in backend sources.
- Clean PostgreSQL migration deployment, including the tenant-integrity
  migration.
- API unit/integration and frozen-contract suites.
- Database schema/client integration suites.
- Worker, scheduler, real BullMQ and message-dispatch integration suites.
- Workspace lint, typecheck, build and runtime smoke gates.

## Environment-dependent residual risks

These are deployment capabilities, not hidden passing test results:

- Email delivery and the message provider are local/fake adapters. Provider
  sandbox and production delivery must be validated when F8 introduces the
  real integrations.
- Mutation rate limiting now uses an atomic Redis counter shared by API
  instances. If Redis is temporarily unavailable, the API logs the transition
  and enforces a process-local fail-safe budget until Redis recovers. Cloudflare
  edge limiting remains a deployment defense-in-depth task.
- Local file storage assumes a single shared filesystem. Multi-instance
  deployment needs shared object storage.
- No production API URL or production environment is configured, so TLS,
  proxy hops, backups/restores, provider credentials and live observability
  cannot be exercised here.
- Independent penetration testing, sustained load testing and disaster
  recovery drills remain release/operations gates.
