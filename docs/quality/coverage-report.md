# F6 coverage report

Generated on 2026-07-29 with:

```powershell
$env:DATABASE_URL = "postgresql://mensaly_test:mensaly_test_local@localhost:55432/mensaly_test?schema=public"
$env:REDIS_URL = "redis://localhost:56379"
pnpm --filter @mensaly/api test:coverage
```

The measured statement, branch and function values are updated from the final
clean F6 run. Coverage is an observation, not the sole acceptance gate:
authorization, concurrency, database constraints, migrations, compiled runtime
and restore behavior have separate tests.

| Metric | Result |
| --- | ---: |
| Statements | 94.24% |
| Branches | 84.47% |
| Functions | 94.58% |

The run completed with 23/23 API tests. The report includes application source
and the workspace packages loaded by the API process.
