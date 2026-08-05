# Manual custom enrollment amount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the manual student form to store an optional, enrollment-specific monthly amount while keeping the selected plan attached.

**Architecture:** The operational API already accepts `CreateEnrollmentInput.amountCents` and persists it on `Enrollment`; scheduled charges read that enrollment value. The web form will reveal a Brazilian-real amount input only when enabled, validate and convert it to integer cents, and send it only for manual enrollment creation.

**Tech Stack:** React, TypeScript, Zod, NestJS, Prisma, PostgreSQL.

## Global Constraints

- The public responsible form must not expose or accept a custom amount.
- Monetary values are stored and sent as integer cents.
- The selected plan remains the enrollment's `planId` and source of due-date settings.

---

### Task 1: Validate the manual amount conversion

**Files:**
- Create: `apps/web/src/lib/money.test.ts`
- Modify: `apps/web/src/lib/money.ts`

- [ ] **Step 1: Write the failing test**

```ts
assert.equal(parseBrazilianAmountToCents("120,50"), 12050);
assert.equal(parseBrazilianAmountToCents("R$ 1.200,00"), 120000);
assert.equal(parseBrazilianAmountToCents("0"), null);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test apps/web/src/lib/money.test.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
export function parseBrazilianAmountToCents(value: string): number | null {
  // normalize BRL notation and return a positive integer amount in cents
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test apps/web/src/lib/money.test.ts`

### Task 2: Send the custom amount from manual enrollment only

**Files:**
- Modify: `apps/web/src/routes/dados-adicionais.tsx`
- Test: `apps/web/src/lib/money.test.ts`

- [ ] **Step 1: Extend the manual form state**

```ts
const emptyManualStudent = { /* existing fields */, customAmountEnabled: false, customAmount: "" };
```

- [ ] **Step 2: Add the checkbox and conditional BRL input below plan selection**

```tsx
<Checkbox checked={manualStudent.customAmountEnabled} />
{manualStudent.customAmountEnabled ? <Input inputMode="decimal" /> : null}
```

- [ ] **Step 3: Validate and send cents only when enabled**

```ts
const amountCents = manualStudent.customAmountEnabled
  ? parseBrazilianAmountToCents(manualStudent.customAmount)
  : null;
await apiRequest("/enrollments", {
  method: "POST",
  body: { /* existing fields */, ...(amountCents ? { amountCents } : {}) },
});
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @mensaly/web typecheck`
