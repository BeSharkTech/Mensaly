# Front-end integration guide — API v1

Registration creates a pending account. Production navigates to
`/verificar-email?email=...`, and login remains blocked until the token is
consumed. Local development may return `devVerificationToken` solely to test
the complete confirmation flow without an external provider.

The production web application uses Next.js App Router. During local
development, Next rewrites `/api/v1/*` to the API service so authentication
continues to use the same-origin HTTP-only session cookie.

## Base contract

- Base path: `/api/v1`.
- Interactive contract: `/api/docs-json`.
- Frozen contract: `docs/api/openapi.v1.json`.
- Authentication uses the `mensaly_session` HTTP-only cookie.
- Browser requests must use `credentials: "include"`.
- Monetary values are integer cents; calendar months use `YYYY-MM`.
- The server derives the organization from the session. Never send or persist
  a selectable organization identifier for a company owner.

Successful single-resource responses use `{ "data": ... }`. Paginated
responses use `{ "data": [], "meta": { "page", "limit", "total", "pages" } }`.
Some original operational CRUD endpoints return the resource directly. The web
client normalizes both frozen v1 shapes through `apiRequest` and
`apiEnvelopeRequest`; new endpoints must use the envelope and must not introduce
another response shape. Changing the remaining legacy endpoints requires a
versioned compatibility plan instead of a silent breaking change.

## Suggested startup flow

1. Register with `POST /auth/register` or call `POST /auth/login`. Registration
   currently activates the owner immediately; email verification is
   intentionally disabled until that product feature is reintroduced.
2. Call `GET /auth/session`.
3. On `401`, show login.
4. For a `COMPANY_ACCOUNT`, call `GET /organization`.
5. If it returns `ORGANIZATION_NOT_FOUND`, show owner onboarding.
6. For a `PLATFORM_ADMIN`, use only `/admin/*` routes.
7. Render inactive or blocked states from the API instead of guessing locally.

## Main screens

- Dashboard: `/dashboard/overview`, `/upcoming-due`,
  `/recent-payments`, `/message-failures`, `/monthly-evolution`.
- Operations: `/plans`, `/students`, `/guardians`, `/enrollments`. New student
  and guardian registrations require a valid CPF; the guardian field remains
  named `taxId` in the API for compatibility, but accepts CPF only.
- Finance: `/charges`, charge actions and payment actions.
- Reminders: `/reminder-configuration`, `/message-templates`,
  `/message-schedules`.
- Files: `/files` with multipart upload and content download.
- Audit: `/audit-logs`.
- Lovable workspace features: `/workspace`, `/workspace/products`,
  `/workspace/events`, `/workspace/custom-fields`,
  `/workspace/student-field-values/:studentId`, `/workspace/broadcasts` and
  `/workspace/broadcast-sends`.
- Public custom form: `/public/forms/:organizationId` and its `/responses`
  endpoint. Submit `cpf` (not the student's name); the server resolves the
  active student inside that organization and validates required fields.
- Platform: `/admin/overview`, `/admin/organizations`,
  `/admin/failures`, organization history and status.

## Reliability rules

- Generate and reuse one `Idempotency-Key` for each manual payment intent.
- On `409`, refetch the resource before offering another transition.
- On `429`, wait for `Retry-After`.
- Show the `correlationId` in support-facing errors.
- Do not retry permanent message or webhook failures automatically.
- Treat a message as delivered only when its domain status says delivered.
