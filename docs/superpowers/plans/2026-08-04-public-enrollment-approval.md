# Public Enrollment Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make public student registrations pending requests that an authenticated local administrator approves or permanently deletes.

**Architecture:** Persist a sanitized pending submission snapshot instead of operational student records. An authenticated approval service materializes student, guardian, enrollment and charge atomically; a permanent reject path deletes the pending row and its uploaded photo while keeping only non-PII audit metadata. A dedicated panel route uses the authenticated APIs and keeps decision controls out of the public form.

**Tech Stack:** NestJS, Fastify, Prisma/PostgreSQL, React, TanStack Router, shadcn/Radix UI, Vitest.

## Global Constraints

- Derive organization from the authenticated session for all panel actions.
- Store money in integer cents and use server-side plan data only.
- Never log public-form personal data, signed tokens or photo content.
- Approve with PostgreSQL transaction and advisory locks; reject removes stored photo and pending data permanently.
- Keep actions keyboard-accessible with 44 px touch targets and no hover-only behavior.

---

### Task 1: Persist pending enrollment snapshots

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_public_enrollment_approval/migration.sql`
- Modify: `apps/api/src/public-enrollment/public-enrollment.dto.ts`
- Test: `apps/api/src/public-enrollment/public-enrollment.integration.test.ts`

**Interfaces:**
- Produces `PublicEnrollmentSubmission.status`, pending data fields and nullable materialized-record references.
- Consumes the existing `SubmitPublicEnrollmentInput` public payload.

- [ ] **Step 1: Write the failing integration test for a public submission**

```ts
expect(result).toMatchObject({ accepted: true, status: "PENDING" });
expect(await prisma.student.count()).toBe(0);
expect(await prisma.publicEnrollmentSubmission.count()).toBe(1);
```

- [ ] **Step 2: Run the targeted integration test and verify it fails because submissions currently create a student**

Run: `pnpm --filter @mensaly/api test -- public-enrollment.integration.test.ts`

- [ ] **Step 3: Add the pending snapshot schema and migration**

Use a `status` enum/value, nullable operational references, JSON snapshot fields for student/guardian/plan/custom values and a required pending photo reference. Keep consent, request hash, idempotency and IP hash.

- [ ] **Step 4: Change public submit to store only the validated snapshot**

Validate document, phone, plan availability, custom fields and photo ownership before creating the pending row. Do not create `Student`, `Guardian`, `Enrollment`, `Charge` or `StudentFieldValue`.

- [ ] **Step 5: Run the targeted integration test and verify it passes**

Run: `pnpm --filter @mensaly/api test -- public-enrollment.integration.test.ts`

### Task 2: Add authenticated review and decision APIs

**Files:**
- Modify: `apps/api/src/public-enrollment/public-enrollment.controller.ts`
- Modify: `apps/api/src/public-enrollment/public-enrollment.service.ts`
- Modify: `apps/api/src/public-enrollment/public-enrollment.module.ts`
- Modify: `apps/api/src/common/local-rate-limit.ts`
- Test: `apps/api/src/public-enrollment/public-enrollment.integration.test.ts`
- Test: `apps/api/src/openapi-contract.test.ts`

**Interfaces:**
- Produces `GET /api/v1/workspace/public-enrollment-submissions`, `POST .../:id/approve` and `DELETE .../:id`.
- Consumes session-derived `AuthenticatedContext` and the pending snapshot from Task 1.

- [ ] **Step 1: Write failing tests for list, approval and permanent reject**

```ts
await service.approve(auth, submission.id, metadata);
expect(await prisma.student.count()).toBe(1);
await service.reject(auth, pending.id, metadata);
expect(await prisma.publicEnrollmentSubmission.findUnique({ where: { id: pending.id } })).toBeNull();
```

- [ ] **Step 2: Run the targeted tests and verify they fail because decision methods do not exist**

Run: `pnpm --filter @mensaly/api test -- public-enrollment.integration.test.ts`

- [ ] **Step 3: Implement list and approval**

List only own organization submissions. On approval, lock submission/document/guardian, revalidate mutable dependencies, create student, guardian/link, enrollment, charge and custom values in one transaction, then update the submission to `APPROVED` and write audit metadata.

- [ ] **Step 4: Implement permanent reject**

Require pending state, delete the uploaded file from storage, delete the submission snapshot, and write `public_enrollment.rejected_and_deleted` audit data without PII. If storage deletion fails, leave the submission pending.

- [ ] **Step 5: Regenerate OpenAPI and run API contract tests**

Run: `pnpm --filter @mensaly/api test -- openapi-contract.test.ts public-enrollment.integration.test.ts`

### Task 3: Build the permissions panel

**Files:**
- Create: `apps/web/src/lib/public-enrollment-submissions.ts`
- Create: `apps/web/src/routes/permissoes-cadastro.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/routeTree.gen.ts`
- Test: `apps/web/src/routes/permissoes-cadastro.test.tsx`

**Interfaces:**
- Consumes the authenticated submission list and decision APIs from Task 2.
- Produces the `/permissoes-cadastro` route and navigation item.

- [ ] **Step 1: Write failing UI tests**

```tsx
render(<PermissionsPage />);
expect(await screen.findByText("Solicitações pendentes")).toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "Recusar" }));
expect(screen.getByRole("alertdialog")).toHaveTextContent("excluir definitivamente");
```

- [ ] **Step 2: Run the UI test and verify it fails because the route is absent**

Run: `pnpm --filter @mensaly/web test -- permissoes-cadastro.test.tsx`

- [ ] **Step 3: Implement the page and navigation**

Render pending cards first with photo, student, guardian, selected plan and date. Show a dialog for full details. Approval is a visible primary action. Recusal opens a destructive `AlertDialog`; only its final confirm calls `DELETE`.

- [ ] **Step 4: Update public-form success copy**

Replace immediate-registration wording with confirmation that the request was sent for local review.

- [ ] **Step 5: Run UI tests and responsive checks**

Run: `pnpm --filter @mensaly/web test -- permissoes-cadastro.test.tsx route-modules.test.tsx`

### Task 4: Validate migration, safety and end-to-end behavior

**Files:**
- Modify: `docs/operations/public-student-enrollment.md`
- Test: `apps/api/src/public-enrollment/public-enrollment.integration.test.ts`
- Test: `apps/web/src/routes/permissoes-cadastro.test.tsx`

- [ ] **Step 1: Add regressions for cross-organization access, stale plan, concurrent approval and rollback**

```ts
await expect(service.approve(otherOrganizationAuth, submission.id, metadata)).rejects.toMatchObject({ status: 404 });
await expect(Promise.all([service.approve(auth, id, metadata), service.approve(auth, id, metadata)])).resolves.toHaveLength(2);
expect(await prisma.student.count()).toBe(1);
```

- [ ] **Step 2: Apply the migration to local development and test databases**

Run: `pnpm --filter @mensaly/database prisma migrate deploy`

- [ ] **Step 3: Run full automated gates**

Run: `pnpm --filter @mensaly/api test && pnpm --filter @mensaly/api typecheck && pnpm --filter @mensaly/api lint && pnpm --filter @mensaly/web test && pnpm --filter @mensaly/web typecheck && pnpm --filter @mensaly/web lint`

- [ ] **Step 4: Manually verify the local flow**

Submit public form, confirm it is absent from Alunos, approve it in Permissões de cadastro, confirm student/enrollment/charge exist, then submit another request and permanently reject it, confirming the file and row no longer exist.

- [ ] **Step 5: Update operational documentation**

Document pending approval, permanent rejection, recovery behavior when file deletion fails, and the production smoke test.
