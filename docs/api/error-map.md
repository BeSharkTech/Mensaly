# API v1 error map

Every error uses the same envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [{ "field": "page", "message": "Expected number" }]
  },
  "correlationId": "c0a80121-7ac0-4b60-a98f-9c639336a001",
  "timestamp": "2026-07-29T12:00:00.000Z",
  "path": "/api/v1/students?page=NaN"
}
```

| HTTP | Codes | Client action |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR`, `TAX_ID_INVALID`, `PHONE_INVALID`, `TIMEZONE_INVALID`, `INVALID_FILE_NAME`, `INVALID_FILE_SIZE`, `INVALID_FILE_TYPE`, `PAYMENT_AMOUNT_MISMATCH`, `GUARDIAN_LINK_REQUIRED` | Correct the request. Use `details` for field errors. |
| 401 | `INVALID_CREDENTIALS`, `SESSION_REQUIRED`, `SESSION_INVALID`, `EMAIL_NOT_VERIFIED` | Reauthenticate or complete verification. |
| 403 | `ACCOUNT_BLOCKED`, `COMPANY_ACCOUNT_REQUIRED`, `PLATFORM_ADMIN_REQUIRED`, `ORGANIZATION_INACTIVE` | Do not retry without a permission or account-state change. |
| 404 | `ORGANIZATION_NOT_FOUND`, `RESOURCE_NOT_FOUND`, `FILE_NOT_FOUND`, `CHARGE_NOT_FOUND`, `MESSAGE_TEMPLATE_NOT_FOUND`, `MESSAGE_SCHEDULE_NOT_FOUND`, `WEBHOOK_EVENT_NOT_FOUND`, `REMINDER_CONFIGURATION_NOT_FOUND` | Refresh local state; never infer that another tenant owns the identifier. |
| 409 | `ORGANIZATION_ALREADY_EXISTS`, `TAX_ID_ALREADY_REGISTERED`, `EMAIL_ALREADY_REGISTERED`, `CHARGE_STATE_CONFLICT`, `CHARGE_HAS_ACTIVE_PAYMENT`, `PAYMENT_ALREADY_EXISTS`, `PAYMENT_STATE_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `MESSAGE_TEMPLATE_NAME_CONFLICT`, `MESSAGE_SCHEDULE_STATE_CONFLICT`, `WEBHOOK_EVENT_CONFLICT` | Reconcile current server state. |
| 429 | `RATE_LIMITED`, `LOGIN_RATE_LIMITED` | Respect `Retry-After`; use exponential backoff. |
| 503 | `DEPENDENCIES_NOT_READY`, `FILE_STORAGE_UNAVAILABLE` | Retry with bounded backoff and surface degraded status. |

Permanent message and webhook failures are domain states returned by their
resources; they are not automatically represented as HTTP failures.
