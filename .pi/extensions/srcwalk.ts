/**
 * Srcwalk Extension — Code Navigation & Git Review
 *
 * Registers srcwalk as the sole code navigation backend. All tools run through
 * the installed `srcwalk` binary (default: `srcwalk` on PATH, override with
 * PI_SRCWALK_BIN=/absolute/path/to/srcwalk).
 *
 * CORE SRCWALK TOOLS:
 *   - srcwalk_search   — Multi-mode search (symbol, text, access evidence)
 *   - srcwalk_read     — Smart file reading with outlining + section drill-in
 *   - srcwalk_files    — Glob-based file discovery
 *   - srcwalk_deps     — Blast-radius / dependency coupling
 *
 * NATIVE SRCWALK TOOLS:
 *   - srcwalk_map      — Token-annotated project overview
 *   - srcwalk_callers  — Multi-hop reverse call graph (BFS up to 5 hops)
 *   - srcwalk_callees  — Forward call graph with detailed ordered call sites
 *   - srcwalk_context  — Flow Map packet with call neighborhood
 *   - srcwalk_impact   — Heuristic blast-radius triage
 *
 * GIT EVIDENCE TOOLS:
 *   - srcwalk_review   — Review Packet for staged or commit-range diffs
 *   - srcwalk_compare  — Structural comparison of two targets
 *
 * CONFIG:
 *   - PI_SRCWALK_BIN=/absolute/path/to/srcwalk  (default: "srcwalk" on PATH)
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type AgentToolResult,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { buildSubprocessEnv } from "./security/env-policy.js";
import { execFilePromise, isAbortError } from "./lib/util.js";

type ToolArgs = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`\`${name}\` must be an array of file paths`);
  }
  const result = value
    .map((entry) => optionalString(entry))
    .filter((entry): entry is string => entry !== undefined);
  if (result.length !== value.length) {
    throw new Error(`\`${name}\` must contain only non-empty file paths`);
  }
  return result;
}

function requireString(value: unknown, name: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`\`${name}\` is required`);
  return result;
}

function resolveSrcwalkBin(): string {
  const configured = process.env.PI_SRCWALK_BIN?.trim();
  if (configured) return configured;

  const home = os.homedir();
  const fallbackBins = [
    path.join(home, ".cargo/bin/srcwalk"),
    path.join(home, ".local/bin/srcwalk"),
    path.join(home, ".nvm/versions/node", `v${process.versions.node}`, "bin/srcwalk"),
    "/opt/homebrew/bin/srcwalk",
    "/usr/local/bin/srcwalk",
  ];

  return fallbackBins.find((candidate) => existsSync(candidate)) || "srcwalk";
}

// ---------------------------------------------------------------------------
// Core srcwalk runner
// ---------------------------------------------------------------------------

function run(args: string[], signal?: AbortSignal): Promise<string> {
  const srcwalkBin = resolveSrcwalkBin();

  return execFilePromise({
    bin: srcwalkBin,
    args,
    env: buildSubprocessEnv("srcwalk"),
    signal,
    onNotFound: () =>
      `srcwalk binary \`${srcwalkBin}\` not found on PATH. ` +
      "Install via: npm install -g srcwalk  or  cargo install srcwalk --locked\n" +
      "Or set PI_SRCWALK_BIN to override, e.g. PI_SRCWALK_BIN=$HOME/.cargo/bin/srcwalk",
  });
}

// ---------------------------------------------------------------------------
// Tool executor implementations
// ---------------------------------------------------------------------------

function buildReadArgs(filePath: string, args: ToolArgs): string[] {
  const cmdArgs = [filePath];
  const section = optionalString(args.section);
  const full = optionalBoolean(args.full);
  const budget = optionalNumber(args.budget);
  const contextLines = optionalNumber(args.contextLines);
  if (section) cmdArgs.push("--section", section);
  if (full) cmdArgs.push("--full");
  if (contextLines !== undefined) cmdArgs.push("--context-lines", String(contextLines));
  if (budget !== undefined) cmdArgs.push("--budget", String(budget));
  return cmdArgs;
}

async function searchCompat(args: ToolArgs, signal?: AbortSignal): Promise<string> {
  const query = requireString(args.query, "query");
  const kind = optionalString(args.kind);
  const scope = optionalString(args.scope);
  const scopes = readStringArray(args.scopes, "scopes");
  const exclude = optionalString(args.exclude);
  const expand = optionalNumber(args.expand);
  const offset = optionalNumber(args.offset);
  const asAccess = optionalBoolean(args.asAccess);
  const matchMode = optionalString(args.matchMode);
  const budget = optionalNumber(args.budget);
  // context is accepted for API compat but not forwarded (srcwalk has no matching flag)

  let cmdArgs: string[];
  if (asAccess) {
    cmdArgs = ["discover", "--as", "access", query];
  } else if (kind === "callers") {
    cmdArgs = ["trace", "callers", query];
  } else {
    cmdArgs = ["discover", query];
  }

  // Handle scopes: prefer `scopes` array, fall back to single `scope`
  if (scopes.length > 0) {
    for (const s of scopes) {
      cmdArgs.push("--scope", s);
    }
  } else if (scope) {
    cmdArgs.push("--scope", scope);
  }

  if (exclude) cmdArgs.push("--exclude", exclude);
  if (matchMode === "any" || matchMode === "all") cmdArgs.push("--match", matchMode);
  if (expand !== undefined) cmdArgs.push("--expand", String(expand));
  if (offset !== undefined) cmdArgs.push("--offset", String(offset));
  if (budget !== undefined) cmdArgs.push("--budget", String(budget));
  return run(cmdArgs, signal);
}

async function readCompat(args: ToolArgs, signal?: AbortSignal): Promise<string> {
  const filePath = optionalString(args.path);
  const paths = readStringArray(args.paths, "paths");
  if (filePath && paths.length > 0) {
    throw new Error("Provide either `path` or `paths`, not both");
  }
  if (!filePath && paths.length === 0) {
    throw new Error("srcwalk_read requires `path` or `paths`");
  }
  if (filePath) return run(buildReadArgs(filePath, args), signal);

  const sections: string[] = [];
  for (const p of paths) {
    const text = await run(buildReadArgs(p, args), signal);
    sections.push(`## ${p}\n\n${text}`);
  }
  return sections.join("\n\n---\n\n");
}

async function filesCompat(args: ToolArgs, signal?: AbortSignal): Promise<string> {
  const pattern = requireString(args.pattern, "pattern");
  const scope = optionalString(args.scope);
  const scopes = readStringArray(args.scopes, "scopes");
  const budget = optionalNumber(args.budget);
  const cmdArgs = ["discover", "--as", "file", pattern];
  if (scopes.length > 0) {
    for (const s of scopes) {
      cmdArgs.push("--scope", s);
    }
  } else if (scope) {
    cmdArgs.push("--scope", scope);
  }
  if (budget !== undefined) cmdArgs.push("--budget", String(budget));
  return run(cmdArgs, signal);
}

async function depsCompat(args: ToolArgs, signal?: AbortSignal): Promise<string> {
  const targetPath = requireString(args.path, "path");
  const scope = optionalString(args.scope);
  const budget = optionalNumber(args.budget);
  const cmdArgs = ["deps", targetPath];
  if (scope) cmdArgs.push("--scope", scope);
  if (budget !== undefined) cmdArgs.push("--budget", String(budget));

  return run(cmdArgs, signal);
}

// ---------------------------------------------------------------------------
// Native srcwalk tool implementations
// ---------------------------------------------------------------------------

async function nativeMap(args: ToolArgs, signal?: AbortSignal): Promise<string> {
  const scope = optionalString(args.scope);
  const depth = optionalNumber(args.depth);
  const symbols = optionalBoolean(args.symbols);
  const cmdArgs = ["overview"];
  if (scope) cmdArgs.push("--scope", scope);
  if (depth !== undefined) cmdArgs.push("--depth", String(depth));
  if (symbols) cmdArgs.push("--symbols");
  return run(cmdArgs, signal);
}

async function nativeCallers(args: ToolArgs, signal?: AbortSignal): Promise<string> {
  const symbol = requireString(args.symbol, "symbol");
  const scope = optionalString(args.scope);
  const depth = optionalNumber(args.depth);
  const filter = optionalString(args.filter);
  const countBy = optionalString(args.countBy);
  const budget = optionalNumber(args.budget);
  const cmdArgs = ["trace", "callers", symbol];
  if (scope) cmdArgs.push("--scope", scope);
  if (depth !== undefined) cmdArgs.push("--depth", String(depth));
  if (filter) cmdArgs.push("--filter", filter);
  if (countBy) cmdArgs.push("--count-by", countBy);
  if (budget !== undefined) cmdArgs.push("--budget", String(budget));
  return run(cmdArgs, signal);
}

async function nativeCallees(args: ToolArgs, signal?: AbortSignal): Promise<string> {
  const symbol = requireString(args.symbol, "symbol");
  const scope = optionalString(args.scope);
  const depth = optionalNumber(args.depth);
  const detailed = optionalBoolean(args.detailed);
  const filter = optionalString(args.filter);
  const budget = optionalNumber(args.budget);
  const cmdArgs = ["trace", "callees", symbol];
  if (scope) cmdArgs.push("--scope", scope);
  if (depth !== undefined) cmdArgs.push("--depth", String(depth));
  if (detailed) cmdArgs.push("--detailed");
  if (filter) cmdArgs.push("--filter", filter);
  if (budget !== undefined) cmdArgs.push("--budget", String(budget));
  return run(cmdArgs, signal);
}

async function nativeContext(args: ToolArgs, signal?: AbortSignal): Promise<string> {
  const target = optionalString(args.target);
  const symbol = optionalString(args.symbol);
  const scope = optionalString(args.scope);
  const filter = optionalString(args.filter);
  const budget = optionalNumber(args.budget);

  let cmdArgs: string[];
  if (target) {
    // Full packet mode: context <path>:<symbol>
    cmdArgs = ["context", target];
  } else if (symbol) {
    // Compact slice mode: context <symbol> --scope <dir>
    cmdArgs = ["context", symbol];
  } else {
    throw new Error("srcwalk_context requires `target` (path:line or path:symbol) or `symbol`");
  }

  if (scope) cmdArgs.push("--scope", scope);
  if (filter) cmdArgs.push("--filter", filter);
  if (budget !== undefined) cmdArgs.push("--budget", String(budget));
  return run(cmdArgs, signal);
}

async function nativeImpact(args: ToolArgs, signal?: AbortSignal): Promise<string> {
  const symbol = requireString(args.symbol, "symbol");
  const scope = optionalString(args.scope);
  const budget = optionalNumber(args.budget);
  const cmdArgs = ["assess", symbol];
  if (scope) cmdArgs.push("--scope", scope);
  if (budget !== undefined) cmdArgs.push("--budget", String(budget));
  return run(cmdArgs, signal);
}

// ---------------------------------------------------------------------------
// Git evidence tool implementations (new in srcwalk v1.0+)
// ---------------------------------------------------------------------------

async function nativeReview(args: ToolArgs, signal?: AbortSignal): Promise<string> {
  const staged = optionalBoolean(args.staged);
  const base = optionalString(args.base);
  const scope = optionalString(args.scope);
  const budget = optionalNumber(args.budget);

  if (!staged && !base) {
    throw new Error("srcwalk_review requires `staged` (boolean) or `base` (revision range, e.g. 'HEAD~1..HEAD')");
  }

  const cmdArgs = ["review"];
  if (staged) cmdArgs.push("--staged");
  if (base) cmdArgs.push(base);
  if (scope) cmdArgs.push("--scope", scope);
  if (budget !== undefined) cmdArgs.push("--budget", String(budget));
  return run(cmdArgs, signal);
}

async function nativeCompare(args: ToolArgs, signal?: AbortSignal): Promise<string> {
  const targetA = requireString(args.targetA, "targetA");
  const targetB = requireString(args.targetB, "targetB");
  const budget = optionalNumber(args.budget);

  const cmdArgs = ["compare", targetA, targetB];
  if (budget !== undefined) cmdArgs.push("--budget", String(budget));
  return run(cmdArgs, signal);
}

// ---------------------------------------------------------------------------
// Tool registration helper
// ---------------------------------------------------------------------------

const MAX_OUTPUT_BYTES = 32_000;

function registerTool(
  pi: ExtensionAPI,
  name: string,
  label: string,
  description: string,
  parameters: ReturnType<typeof Type.Object>,
  executor: (params: ToolArgs, signal: AbortSignal) => Promise<string>,
  promptSnippet?: string,
): void {
  pi.registerTool({
    name,
    label,
    description,
    parameters,
    ...(promptSnippet && { promptSnippet }),
    async execute(
      _toolCallId: string,
      params: ToolArgs,
      signal: AbortSignal | undefined,
      _onUpdate: undefined,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult> {
      const raw = await executor(params, signal);
      const truncated = truncateHead(raw, { maxBytes: MAX_OUTPUT_BYTES });
      if (truncated.truncated) {
        const note =
          `\n\n[Output truncated: ${truncated.bytes} bytes removed. ` +
          `Full output available in the raw tool result file.]`;
        truncated.content += note;
      }
      return { content: [{ type: "text", text: truncated.content }] };
    },
  });
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function srcwalkExtension(pi: ExtensionAPI): void {
  // ---- Core srcwalk_* navigation tools ----------------------------------

  registerTool(
    pi,
    "srcwalk_search",
    "Code Search",
    "Multi-mode code search — symbol definitions, usages, text match, access evidence, or caller trace. " +
      "Symbol search returns definitions first (via tree-sitter AST), then usages, " +
      "with full source code inlined for top matches. " +
      "For cross-file tracing, pass comma-separated symbol names (max 5). " +
      "Supports multi-scope, exclude patterns, access evidence, and OR/co-occurrence text search. " +
      "Prefer srcwalk before raw grep for code-structure queries.",
    Type.Object({
      query: Type.String({
        description:
          "Symbol name, text string, or regex pattern. e.g. 'handleRequest' or 'ServeHTTP,Next' for multi-symbol.",
      }),
      scope: Type.Optional(
        Type.String({
          description: "Search a specific subdirectory. Omit for cwd.",
        }),
      ),
      scopes: Type.Optional(
        Type.Array(Type.String(), {
          description: "Multiple directories to search across (preferred over single `scope`).",
        }),
      ),
      kind: Type.Optional(
        Type.String({
          description: 'Search type: "symbol" (default), "content", "regex", "callers".',
        }),
      ),
      asAccess: Type.Optional(
        Type.Boolean({
          description: "Search for field/member access evidence instead of symbol definitions.",
        }),
      ),
      exclude: Type.Optional(
        Type.String({
          description: "Exclude file patterns, e.g. '*test*' or '{dist,build}/**'.",
        }),
      ),
      matchMode: Type.Optional(
        Type.String({
          description: 'Text match mode: "any" (OR) or "all" (same-file co-occurrence). Requires kind="content" or omitted.',
        }),
      ),
      expand: Type.Optional(
        Type.Number({
          description: "Number of top matches to expand with full source (default 2).",
        }),
      ),
      offset: Type.Optional(
        Type.Number({
          description: "Page offset for paginated results.",
        }),
      ),
      context: Type.Optional(
        Type.String({
          description:
            "Path to file being edited — boosts nearby results (not forwarded to srcwalk).",
        }),
      ),
      budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
    }),
    searchCompat,
    "Multi-mode code search: symbol definitions, text match, access evidence, or caller trace. Prefer srcwalk before rg.",
  );

  registerTool(
    pi,
    "srcwalk_read",
    "Smart File Read",
    "Read a file with smart outlining. Small files return full content. " +
      "Large files return structural outline with import/function/class anchors. " +
      'Use section for line ranges ("45-89"), symbol names, or comma-separated targets "45-89, ## Config". ' +
      'path supports "file:start-end" shortcut for direct range reads. ' +
      "Use paths for batch reading (max 20 files). " +
      "Supports context lines around matches.",
    Type.Object({
      path: Type.Optional(Type.String({ description: "File path to read." })),
      paths: Type.Optional(
        Type.Array(Type.String(), {
          description: "Multiple file paths for batch read.",
        }),
      ),
      section: Type.Optional(
        Type.String({
          description:
            'Line range "45-89", heading "## Architecture", or comma-separated targets "45-89, ## Config".',
        }),
      ),
      full: Type.Optional(Type.Boolean({ description: "Force full content, bypass outlining." })),
      contextLines: Type.Optional(
        Type.Number({
          description:
            "Number of context lines to show around matches (like grep -C).",
        }),
      ),
      budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
    }),
    readCompat,
    "Read files with smart outlining — full content for small files, structural outline for large. Supports sections, batch reads, and context lines.",
  );

  registerTool(
    pi,
    "srcwalk_files",
    "Find Files",
    "Find files matching a glob pattern. Returns matched file paths with token size estimates, " +
      "grouped by directory. Respects .gitignore. " +
      'Supports multi-scope: search across several directories at once.',
    Type.Object({
      pattern: Type.String({
        description: 'Glob pattern: "*" (list dir), "*.rs", "src/**/*.ts".',
      }),
      scope: Type.Optional(Type.String({ description: "Directory to search. Omit for cwd." })),
      scopes: Type.Optional(
        Type.Array(Type.String(), {
          description: "Multiple directories to search across (preferred over single `scope`).",
        }),
      ),
      budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
    }),
    filesCompat,
    "Find files by glob pattern with token size estimates. Supports multi-scope. Respects .gitignore. Prefer srcwalk files over find/ls.",
  );

  registerTool(
    pi,
    "srcwalk_deps",
    "Blast Radius",
    "Blast-radius check before breaking changes. Shows local relation groups and " +
      "outbound dependency previews for narrowed scopes. Use before changing " +
      "signatures, removing/renaming exports, or modifying behavior callers rely on. " +
      "Also supports Markdown/HTML link extraction for documentation files.",
    Type.Object({
      path: Type.String({
        description: "File to check before making breaking changes.",
      }),
      scope: Type.Optional(Type.String({ description: "Directory to search for dependents." })),
      budget: Type.Optional(Type.Number({ description: "Max tokens. Truncates 'Used by' first." })),
    }),
    depsCompat,
    "Blast-radius check — shows imports, dependents, and relation groups for a file.",
  );

  // ---- Native srcwalk tools -----------------------------------------------

  registerTool(
    pi,
    "srcwalk_map",
    "Project Overview",
    "Token-annotated directory skeleton respecting .gitignore, .ignore, git excludes, and parent ignores. " +
      "Shows local relation groups and outbound dependency previews for narrowed scopes. " +
      "Use to understand repo shape, token budgets, and entry points before deep dives. " +
      "Supports budget-adaptive inline symbol anchors.",
    Type.Object({
      scope: Type.Optional(Type.String({ description: "Directory to map. Omit for cwd." })),
      depth: Type.Optional(Type.Number({ description: "Max directory depth (default 3)." })),
      symbols: Type.Optional(
        Type.Boolean({
          description: "Show budget-adaptive inline symbol anchors when budget allows.",
        }),
      ),
      budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
    }),
    nativeMap,
    "Token-annotated repo map — understand codebase shape and token budgets. Supports depth control and symbol anchors.",
  );

  registerTool(
    pi,
    "srcwalk_callers",
    "Caller Graph",
    "Reverse call graph for a symbol. Supports multi-hop BFS (depth up to 5), " +
      "call-site filtering (e.g. 'args:3 receiver:mgr'), and aggregation by receiver or file. " +
      "Hub guard and collision warnings for overloaded symbols. " +
      "Prefer over srcwalk_search(kind: 'callers') when you need depth, filters, or aggregation.",
    Type.Object({
      symbol: Type.String({ description: "Symbol name to trace callers of." }),
      scope: Type.Optional(Type.String({ description: "Directory to search." })),
      depth: Type.Optional(Type.Number({ description: "BFS hop depth (default 1, max 5)." })),
      filter: Type.Optional(
        Type.String({
          description: "Filter expression, e.g. 'args:3 receiver:mgr' or 'path:api'.",
        }),
      ),
      countBy: Type.Optional(
        Type.String({
          description: "Aggregate by 'receiver' or 'file' to see caller groups.",
        }),
      ),
      budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
    }),
    nativeCallers,
    "Reverse call graph with multi-hop BFS (depth up to 5), filters, and aggregation.",
  );

  registerTool(
    pi,
    "srcwalk_callees",
    "Callee Graph",
    "Forward call graph for a symbol — what does this function call, and with what arguments? " +
      "Use detailed for ordered call sites with argument slots and assignment context. " +
      "Use depth for transitive downstream calls. " +
      "Supports filter expressions like 'callee:validateToken'.",
    Type.Object({
      symbol: Type.String({ description: "Symbol name to trace callees of." }),
      scope: Type.Optional(Type.String({ description: "Directory to search." })),
      depth: Type.Optional(Type.Number({ description: "Transitive depth (default 1)." })),
      detailed: Type.Optional(
        Type.Boolean({
          description: "Show ordered call sites with argument slots and context.",
        }),
      ),
      filter: Type.Optional(
        Type.String({
          description: "Filter expression, e.g. 'callee:validateToken'.",
        }),
      ),
      budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
    }),
    nativeCallees,
    "Forward call graph — what does this function call, with arguments. Supports detailed call sites and transitive depth.",
  );

  registerTool(
    pi,
    "srcwalk_context",
    "Context Packet",
    "Flow Map packet for a target — ordered callees, local resolves, direct callers, " +
      "and a structured Flow Map with entry, action, loop, exit nodes. " +
      "Use for quick understanding of a function's role in the call graph. " +
      "Two modes: full packet (target='path:line' or 'path:symbol') or " +
      "compact slice (symbol + scope). Follow up with srcwalk_callees or srcwalk_callers for depth.",
    Type.Object({
      target: Type.Optional(
        Type.String({
          description:
            "Target for full Flow Map packet, e.g. 'src/auth.ts:handleAuth' or 'src/auth.ts:44-89'.",
        }),
      ),
      symbol: Type.Optional(Type.String({ description: "Symbol name for compact slice mode." })),
      scope: Type.Optional(Type.String({ description: "Directory to search (compact slice mode)." })),
      filter: Type.Optional(
        Type.String({ description: "Filter expression, e.g. 'callee:validateToken'." }),
      ),
      budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
    }),
    nativeContext,
    "Flow Map packet for a target — ordered calls, local resolves, callers, and structured Flow Map. Two modes: target=path:symbol or symbol+scope.",
  );

  registerTool(
    pi,
    "srcwalk_impact",
    "Impact Triage",
    "Heuristic blast-radius triage for a symbol. Name-matched, not proof — " +
      "use as a broad starting point before verifying with srcwalk_callers or exact reads. " +
      "Common names like 'run', 'init', 'close' need follow-up with receiver/file groups. " +
      "Triage first, then verify with callers.",
    Type.Object({
      symbol: Type.String({ description: "Symbol name to triage." }),
      scope: Type.Optional(Type.String({ description: "Directory to search." })),
      budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
    }),
    nativeImpact,
    "Heuristic blast-radius triage — broad starting point for 'what might be affected?'.",
  );

  // ---- Git evidence tools ------------------------------------------------

  registerTool(
    pi,
    "srcwalk_review",
    "Review Packet",
    "Git Review Packet — summarize staged or commit-range changes as bounded evidence. " +
      "Outputs changed files, hunks, changed symbols, and bounded Flow Maps for changed " +
      "function-like symbols. Use before committing or when reviewing a PR range.",
    Type.Object({
      staged: Type.Optional(
        Type.Boolean({
          description: "Review staged changes (git diff --staged).",
        }),
      ),
      base: Type.Optional(
        Type.String({
          description:
            "Revision range, e.g. 'HEAD~1..HEAD' or 'main..feature'. Required unless staged=true.",
        }),
      ),
      scope: Type.Optional(
        Type.String({
          description: "Limit review to a subdirectory. Omit for full repo.",
        }),
      ),
      budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
    }),
    nativeReview,
    "Git Review Packet — staged or commit-range change evidence with Flow Maps for changed symbols.",
  );

  registerTool(
    pi,
    "srcwalk_compare",
    "Compare Targets",
    "Structural comparison of two known code targets. " +
      "Accepts targets as 'path:line', 'path:symbol', or 'path:start-end'. " +
      "Use when you need to compare two functions, types, or modules structurally.",
    Type.Object({
      targetA: Type.String({
        description: "First target: 'path:line', 'path:symbol', or 'path:start-end'.",
      }),
      targetB: Type.String({
        description: "Second target: 'path:line', 'path:symbol', or 'path:start-end'.",
      }),
      budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
    }),
    nativeCompare,
    "Structural comparison of two code targets — compare functions, types, or modules.",
  );
}
