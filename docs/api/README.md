# API v1

The HTTP contract is frozen as version `1.0.0` under `/api/v1`.

- `openapi.v1.json`: machine-readable contract generated from the application.
- `examples.http`: ready-to-run request examples.
- `error-map.md`: stable error envelope and status-code guidance.

Regenerate the contract with:

```bash
pnpm api:openapi
```

The API test suite compares the live document with the committed file and fails
when an endpoint changes without an explicit contract update.
