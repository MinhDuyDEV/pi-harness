import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { DiagnosticsDetails } from "./types.ts";
import { parseDiagnosticsBlocks, stripDiagnosticsBlocks } from "./parse-blocks.ts";

const MAX_COLLAPSED_LINES_PER_BLOCK = 3;
const MAX_EXPANDED_LINES_PER_BLOCK = 40;

function getTextContent(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  return first?.type === "text" && first.text ? first.text : "";
}

function statusPrefix(ok: boolean | undefined, theme: Theme): string {
  if (ok === true) return theme.fg("success", "[ok]");
  if (ok === false) return theme.fg("error", "[fail]");
  return theme.fg("warning", "[--]");
}

export function renderDiagnosticsCall(
  args: Record<string, unknown> | undefined,
  theme: Theme,
): Text {
  const parts = [theme.fg("toolTitle", theme.bold("⚙ diagnostics"))];
  const scope = args?.scope;
  if (scope === "changed" || scope === "full") {
    parts.push(theme.fg("muted", ` scope=${scope}`));
  }
  if (Array.isArray(args?.languages) && args.languages.length) {
    parts.push(theme.fg("dim", ` [${args.languages.join(", ")}]`));
  }
  return new Text(parts.join(""), 0, 0);
}

export function renderDiagnosticsResult(
  result: {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  options: { expanded: boolean; isPartial?: boolean },
  theme: Theme,
): Text {
  if (options.isPartial) {
    return new Text(theme.fg("warning", "Running diagnostics…"), 0, 0);
  }

  const raw = getTextContent(result);
  const details = result.details as DiagnosticsDetails | undefined;
  const parsed = parseDiagnosticsBlocks(raw);
  const preamble = stripDiagnosticsBlocks(raw);

  if (parsed.length === 0) {
    const fallback = preamble || raw || theme.fg("dim", "No output");
    return new Text(theme.fg("text", fallback), 0, 0);
  }

  const metaById = new Map(details?.blocks?.map((b) => [b.id, b]) ?? []);
  const idForTool = (toolLabel: string): string => {
    const lower = toolLabel.toLowerCase();
    if (lower.includes("typescript") || lower.includes("tsc")) return "typescript";
    if (lower.includes("fallow")) return "fallow";
    if (lower.includes("aislop")) return "aislop";
    if (lower.includes("rust")) return "rust";
    if (lower.includes("go")) return "go";
    if (lower.includes("python")) return "python";
    return toolLabel;
  };

  const lines: string[] = [];

  if (preamble) {
    lines.push(theme.fg("muted", preamble));
    lines.push("");
  }

  if (details?.walkedUp && details.projectRoot) {
    lines.push(theme.fg("dim", `root: ${details.projectRoot}`));
    lines.push("");
  }

  for (const block of parsed) {
    const meta = metaById.get(idForTool(block.tool));
    const head = `${statusPrefix(meta?.ok, theme)} ${theme.fg("toolTitle", block.tool)}`;
    lines.push(head);

    const limit = options.expanded ? MAX_EXPANDED_LINES_PER_BLOCK : MAX_COLLAPSED_LINES_PER_BLOCK;
    const show = block.lines.slice(0, limit);
    for (const line of show) {
      const isErrorish = /error TS|error:|ERR\]|\[ERR\]/i.test(line);
      lines.push(
        theme.fg(isErrorish ? "error" : "dim", `  ${line}`),
      );
    }
    if (block.lines.length > limit) {
      lines.push(
        theme.fg("muted", `  … ${block.lines.length - limit} more line(s) — expand to view`),
      );
    }

    if (options.expanded && meta?.fullOutputPath) {
      lines.push(theme.fg("dim", `  full: ${meta.fullOutputPath}`));
    }
    lines.push("");
  }

  return new Text(lines.join("\n").trimEnd(), 0, 0);
}