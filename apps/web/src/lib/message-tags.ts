export function insertMessageTag(
  value: string,
  tag: string,
  start: number,
  end: number,
) {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  return {
    value: `${value.slice(0, safeStart)}${tag}${value.slice(safeEnd)}`,
    cursor: safeStart + tag.length,
  };
}

export function normalizeMessageEditorValue(value: string) {
  return value.replace(/\n$/, "");
}
