# Student Exports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the filtered student list by plan as branded PDF or CSV and download a full individual student record as PDF.

**Architecture:** Keep export-data shaping in a pure web utility that receives dashboard rows. The Alunos route owns the export controls and passes session-scoped data only; PDF rendering and browser download happen locally.

**Tech Stack:** React, TypeScript, jsPDF, jsPDF-AutoTable, Vitest.

## Global Constraints

- Use only data scoped by the authenticated dashboard session.
- Keep money in integer cents until it is formatted for display.
- CSV must neutralize spreadsheet formulas and use semicolon separators.
- The list respects the selected plan and optionally includes payment status.

---

### Task 1: Export data utility

**Files:**
- Create: `apps/web/src/lib/student-export.ts`
- Create: `apps/web/src/lib/student-export.test.ts`

**Interfaces:**
- Produces `buildStudentExportRows`, `toStudentCsv`, and `groupStudentsByPlan` for the Alunos route.

- [ ] **Step 1: Write failing tests** for plan grouping, omitted payment fields and CSV formula escaping.
- [ ] **Step 2: Run** `pnpm exec vitest run apps/web/src/lib/student-export.test.ts` and confirm the missing utility fails.
- [ ] **Step 3: Implement** the minimal pure types and helpers.
- [ ] **Step 4: Run** the same test until it passes.

### Task 2: PDF generator

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/src/lib/student-export.ts`
- Modify: `apps/web/src/lib/student-export.test.ts`

**Interfaces:**
- Consumes `StudentExportRow` and brand information.
- Produces `downloadStudentListPdf` and `downloadStudentProfilePdf`.

- [ ] **Step 1: Write failing tests** for the profile section data and filename generation.
- [ ] **Step 2: Run** the targeted Vitest file and confirm expected failure.
- [ ] **Step 3: Add** browser PDF dependencies and minimal branded document generation.
- [ ] **Step 4: Run** the targeted test until it passes.

### Task 3: Alunos controls and profile action

**Files:**
- Modify: `apps/web/src/routes/alunos.tsx`

**Interfaces:**
- Consumes the export helpers and `useDashboardData` session-scoped data.

- [ ] **Step 1: Add** an accessible export dialog with format and payment-status choices, disabled when the current filter is empty.
- [ ] **Step 2: Add** a `Baixar ficha PDF` action to the student profile/edit dialog.
- [ ] **Step 3: Validate** `pnpm --filter @mensaly/web typecheck` and targeted lint.

### Task 4: Final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-student-exports-design.md`

- [ ] **Step 1: Run** unit tests, frontend typecheck and frontend build.
- [ ] **Step 2: Inspect** the diff for secret exposure, session/organization boundaries and disabled empty-state controls.
- [ ] **Step 3: Record** any environmental test blocker separately from feature failures.
