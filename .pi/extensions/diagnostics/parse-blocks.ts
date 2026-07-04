export interface ParsedDiagnosticsBlock {
  tool: string;
  lines: string[];
}

const BLOCK_RE = /<diagnostics tool="([^"]*)">\s*([\s\S]*?)<\/diagnostics>/g;

/** Strip the two-space indent emitted by `buildBlock`. */
function normalizeInnerLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
    .filter((line) => line.length > 0);
}

export function parseDiagnosticsBlocks(text: string): ParsedDiagnosticsBlock[] {
  const blocks: ParsedDiagnosticsBlock[] = [];
  let match: RegExpExecArray | null;
  BLOCK_RE.lastIndex = 0;
  while ((match = BLOCK_RE.exec(text)) !== null) {
    blocks.push({
      tool: match[1]!,
      lines: normalizeInnerLines(match[2]!),
    });
  }
  return blocks;
}

/** Text outside `<diagnostics>` blocks (e.g. project root header). */
export function stripDiagnosticsBlocks(text: string): string {
  return text.replace(BLOCK_RE, "").trim();
}