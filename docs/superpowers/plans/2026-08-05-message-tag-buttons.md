# Message tag buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users insert student, guardian and payment-link tags through visible buttons, with tokens highlighted in the organization accent color.

**Architecture:** A small pure helper will insert a token at a text selection and preserve the stored bracket syntax. The message form will replace its plain textarea with a `contentEditable` editor that serializes the visible tokens back to `[aluno]`, `[responsavel]` and `[link]` before saving.

**Tech Stack:** React, TypeScript, Tailwind CSS.

## Global Constraints

- Existing stored messages remain plain text using the existing bracket tokens.
- Buttons must be keyboard reachable and maintain a 44px touch target.
- Tag color uses the existing `text-primary` and `bg-primary/10` semantic tokens.

---

### Task 1: Token insertion helper

**Files:**
- Create: `apps/web/src/lib/message-tags.ts`
- Create: `apps/web/src/lib/message-tags.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
assert.deepEqual(insertMessageTag("Olá mundo", "[aluno]", 4, 4), {
  value: "Olá [aluno]mundo",
  cursor: 12,
});
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm exec tsx --test apps/web/src/lib/message-tags.test.ts`

- [ ] **Step 3: Implement the helper**

```ts
export function insertMessageTag(value: string, tag: string, start: number, end: number) {
  const next = `${value.slice(0, start)}${tag}${value.slice(end)}`;
  return { value: next, cursor: start + tag.length };
}
```

- [ ] **Step 4: Re-run test**

Run: `pnpm exec tsx --test apps/web/src/lib/message-tags.test.ts`

### Task 2: Replace the message textarea

**Files:**
- Modify: `apps/web/src/routes/envio.tsx`
- Test: `apps/web/src/lib/message-tags.test.ts`

- [ ] **Step 1: Add buttons for `Nome do aluno`, `Nome do responsável`, and `Link do pagamento`**

```tsx
<Button type="button" variant="outline" onClick={() => insertTag("[aluno]")}>Nome do aluno</Button>
```

- [ ] **Step 2: Render stored tokens as non-editable accent chips inside the editor**

```tsx
<span contentEditable={false} className="rounded bg-primary/10 px-1 text-primary">Nome do aluno</span>
```

- [ ] **Step 3: Serialize content back to bracket tokens on input and preserve insertion position**

```ts
set("body", editorTextWithBracketTokens(editor));
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @mensaly/web typecheck`
