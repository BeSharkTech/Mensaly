# Security hardening review

## Request boundary

- Mutation requests use an in-process fixed-window limit per trusted socket IP.
- Authentication and recovery routes have a separate, lower budget.
- `trustProxy` remains disabled, so forwarded IP headers cannot select a bucket.
- Request bodies are bounded globally and file uploads have independent byte,
  part, field, and file-count limits.
- All mutable DTOs are strict: unknown fields are rejected instead of being
  copied into database writes.
- List queries use Zod coercion and enforce positive pages and a maximum page
  size of 100.

The local limiter reduces accidental bursts and single-instance abuse. A
shared edge or Redis limiter is still required before horizontal scaling.

## Authorization and audit

- Company identity is derived from the authenticated owner session.
- Company routes reject platform administrators and admin routes reject company
  accounts.
- `/api/v1/audit-logs` exposes only the authenticated company's immutable
  records, with bounded filters and pagination.
- Cross-company headers and query parameters never override session scope.
- Authorization, tenant isolation, pagination and mass-assignment regressions
  are covered by integration tests.

## Logging

Structured logs redact credentials, cookies, authorization headers, request
bodies, webhook payloads, email addresses, phone numbers, tax identifiers and
external payment references. Audit records remain access-controlled business
records and are not emitted as request logs.

## Database and query review

- Dashboard and list endpoints use includes or page-level batch aggregations;
  no per-row database loop was found.
- Charge dashboard queries are supported by
  `(organizationId, referenceMonth, status)`.
- Existing payment, delivery, webhook, file, audit and due-date indexes match
  their operational filters.
- All financial cross-tenant relations retain composite foreign-key checks.

## Residual controls

Production deployment must also provide TLS, an edge request limit, encrypted
backups, dependency scanning, secret rotation and centralized log retention.
