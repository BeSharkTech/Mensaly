import { expect, test } from "vitest";

import { insertMessageTag, normalizeMessageEditorValue } from "./message-tags";

test("inserts a message tag at the selected text position", () => {
  expect(insertMessageTag("Olá mundo", "[aluno]", 4, 4)).toEqual({
    value: "Olá [aluno]mundo",
    cursor: 11,
  });
});

test("replaces selected text when inserting a message tag", () => {
  expect(insertMessageTag("Olá mundo", "[link]", 4, 9)).toEqual({
    value: "Olá [link]",
    cursor: 10,
  });
});

test("normalizes the browser trailing line break without changing internal line breaks", () => {
  expect(normalizeMessageEditorValue("Olá\n")).toBe("Olá");
  expect(normalizeMessageEditorValue("Olá\nmundo")).toBe("Olá\nmundo");
});
