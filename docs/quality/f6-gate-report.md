# F6 backend gate report

**Date:** 2026-07-29  
**Baseline:** `main` at `586f3cb` after PR `#56`  
**Environment:** isolated local PostgreSQL 17 and Redis 7.2 containers

## Integrated modules

| Module | Scope | Pull request |
| --- | --- | --- |
| 1 | Generic webhook inbox | `#52` |
| 2 | Local file storage abstraction | `#53` |
| 3 | Company dashboard and platform administration | `#54` |
| 4 | Audit and security hardening | `#55` |
| 5 | Frozen API v1 and backend handoff artifacts | `#56` |

Each module passed local review and its monorepo CI before merge.

## Clean-environment gate

The test containers and volumes were removed and recreated before validation.
The following results were observed:

| Check | Result |
| --- | --- |
| Database migration | 16/16 migrations applied from an empty database |
| Production build | 9 build tasks passed |
| Database integration | 7/7 tests passed |
| Worker integration | 13/13 tests passed |
| Typecheck | 9 tasks passed |
| Lint | 10 tasks passed with zero warnings |
| Functional suites | 9 package tasks passed; API 23/23 |
| Compiled runtime | API and worker started, connected and shut down safely |
| API coverage | 94.15% lines, 84.47% branches, 94.31% functions |
| OpenAPI | deterministic export; 74 versioned operations with unique IDs |
| Demo seed | two idempotent runs, real login 200 and tenant-derived company 200 |
| Secret scan | no credential/private-key signature matched |

## Backup and restore drill

A PostgreSQL custom-format archive was created inside the isolated test
container, listed with `pg_restore -l`, restored into a separate disposable
database and queried. The restored database contained all 16 successful
migrations and the deterministic demo organization. The disposable database
and archive were removed after verification.

The first evidence query used an incorrect plural table name and failed. The
archive itself had restored successfully. The drill was repeated from backup
creation through cleanup using the Prisma-mapped `organization` table and
passed completely.

## Acceptance

The F6 backend gate is approved for the defined local scope. No external
provider credential or network integration is required to build, test or run
the validated backend. Production deployment, managed backup retention,
external provider contract tests and operational monitoring remain gates of
their later phases.
