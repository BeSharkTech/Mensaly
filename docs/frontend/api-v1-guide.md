# Front-end integration guide — API v1

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
Some original operational CRUD endpoints return the resource directly; consume
the frozen OpenAPI contract for those legacy shapes until a future API version.

## Suggested startup flow

1. Call `GET /auth/session`.
2. On `401`, show login.
3. For a `COMPANY_ACCOUNT`, call `GET /organization`.
4. If it returns `ORGANIZATION_NOT_FOUND`, show owner onboarding.
5. For a `PLATFORM_ADMIN`, use only `/admin/*` routes.
6. Render inactive or blocked states from the API instead of guessing locally.

## Main screens

- Dashboard: `/dashboard/overview`, `/upcoming-due`,
  `/recent-payments`, `/message-failures`, `/monthly-evolution`.
- Operations: `/plans`, `/students`, `/guardians`, `/enrollments`.
- Finance: `/charges`, charge actions and payment actions.
- Reminders: `/reminder-configuration`, `/message-templates`,
  `/message-schedules`.
- Files: `/files` with multipart upload and content download.
- Audit: `/audit-logs`.
- Platform: `/admin/overview`, `/admin/organizations`,
  `/admin/failures`, organization history and status.

## Reliability rules

- Generate and reuse one `Idempotency-Key` for each manual payment intent.
- On `409`, refetch the resource before offering another transition.
- On `429`, wait for `Retry-After`.
- Show the `correlationId` in support-facing errors.
- Do not retry permanent message or webhook failures automatically.
- Treat a message as delivered only when its domain status says delivered.
