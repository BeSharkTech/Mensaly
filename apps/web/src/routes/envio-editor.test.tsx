import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";

import { MessageEditor } from "./envio";

function ControlledEditor() {
  const [value, setValue] = useState("Olá [aluno]");
  return <MessageEditor value={value} onChange={setValue} />;
}

test("keeps the caret while typing after a saved message tag", async () => {
  const user = userEvent.setup();
  render(<ControlledEditor />);
  const editor = screen.getByRole("textbox", { name: "Mensagem" });
  editor.focus();

  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  await user.type(editor, " OK");

  expect(editor).toHaveTextContent("Olá Nome do aluno OK");
  expect(editor.innerHTML).toContain('data-message-tag="[aluno]"');
});
