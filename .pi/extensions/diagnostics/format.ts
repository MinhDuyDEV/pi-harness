export function buildBlock(toolLabel: string, lines: string[]): string {
  return [
    `<diagnostics tool="${toolLabel}">`,
    ...lines.flatMap((s) => s.split("\n").map((l) => `  ${l}`)),
    "</diagnostics>",
  ].join("\n");
}

export function buildBlockFromRawOutput(toolLabel: string, output: string): string {
  const lines = output.split("\n").filter(Boolean);
  if (lines.length === 0) return "";
  return buildBlock(toolLabel, lines);
}