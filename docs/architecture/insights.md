# Dashboards and platform insights

## Company dashboard

All `/api/v1/dashboard/*` endpoints derive the organization from the
authenticated owner session. They never accept an organization identifier from
the client.

- `overview` summarizes active students and the selected reference month.
- `upcoming-due` returns pending charges in a bounded date window.
- `recent-payments` returns confirmed payments.
- `message-failures` exposes recent retryable and permanent failures.
- `monthly-evolution` returns a continuous, bounded monthly series.

The expected total includes pending and paid charges. The received total is the
sum of confirmed payments whose payment date is in the selected month.
Cancelled charges do not contribute to either total.

Calendar dates are interpreted at midnight UTC after strict validation. When
`asOf` is omitted, the organization's configured timezone determines the
current calendar date.

## Platform administration

The `/api/v1/admin/*` insight routes require a platform administrator session.
They provide global totals, paginated organization consumption, immutable
organization history, and recent operational failures.

Organization list consumption is calculated with batch aggregations for the
current page. Dashboard relationships are loaded with bounded includes and the
monthly series uses two tenant-scoped aggregate queries, avoiding per-row
database queries.

## Limits and isolation

- Page sizes and result limits are capped at 100.
- Evolution is capped at 24 months and upcoming due dates at 90 days.
- Invalid calendar dates are rejected before service execution.
- Company queries always contain the authenticated `organizationId`.
- Cross-company and company-to-admin authorization are regression tested.
