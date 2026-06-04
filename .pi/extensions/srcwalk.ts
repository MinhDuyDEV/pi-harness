/**
 * Srcwalk Extension — Code Intelligence
 *
 * Registers srcwalk as the sole code navigation backend. All tools run through
 * the installed `srcwalk` binary (default: `srcwalk` on PATH, override with
 * PI_SRCWALK_BIN=/absolute/path/to/srcwalk).
 *
 * CORE SRCWALK TOOLS (unified srcwalk_* naming):
 *   - srcwalk_search — Symbol/content/regex/callers search (replaces grep)
 *   - srcwalk_read   — Smart file reading; supports path:start-end shortcut (v0.4.0)
 *   - srcwalk_files  — Glob file finding with token estimates (replaces find/ls)
 *   - srcwalk_deps   — Blast-radius analysis before breaking changes
 *
 * NATIVE SRCWALK TOOLS (new surface):
 *   - srcwalk_map      — Token-annotated directory skeleton
 *   - srcwalk_callers  — Reverse call graph with multi-hop BFS and filters
 *   - srcwalk_callees  — Forward call graph with detailed ordered call sites
 *   - srcwalk_flow     — Compact orientation slice (callers + callees + resolves)
 *   - srcwalk_impact   — Heuristic blast-radius triage
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
import {
	execFilePromise,
	isAbortError,
} from "./util.js";

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

function isAbortError(error: unknown): boolean {
	const candidate = error as { name?: string; code?: string } | undefined;
	return candidate?.name === "AbortError" || candidate?.code === "ABORT_ERR";
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
// Backward-compatible tilth_* tool implementations (srcwalk-backed)
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
	const expand = optionalNumber(args.expand);
	const budget = optionalNumber(args.budget);
	// context is accepted for API compat but not forwarded (srcwalk has no matching flag)
	const cmdArgs = kind === "callers" ? ["trace", "callers", query] : ["discover", query];
	if (scope) cmdArgs.push("--scope", scope);
	if (expand !== undefined) cmdArgs.push(`--expand=${expand}`);
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
	const budget = optionalNumber(args.budget);
	const cmdArgs = ["discover", "--as", "file", pattern];
	if (scope) cmdArgs.push("--scope", scope);
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

async function nativeFlow(args: ToolArgs, signal?: AbortSignal): Promise<string> {
	const symbol = requireString(args.symbol, "symbol");
	const scope = optionalString(args.scope);
	const filter = optionalString(args.filter);
	const budget = optionalNumber(args.budget);
	const cmdArgs = ["context", symbol];
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
		"Search for symbols, text, or regex patterns in code. Replaces grep/rg. " +
			"Symbol search returns definitions first (via tree-sitter AST), then usages, " +
			"with full source code inlined for top matches. " +
			"For cross-file tracing, pass comma-separated symbol names (max 5). " +
			"v1.0.1: Evidence contract — prefer srcwalk before rg for code navigation.",
		Type.Object({
			query: Type.String({
				description:
					"Symbol name, text string, or regex pattern. e.g. 'handleRequest' or 'ServeHTTP,Next' for multi-symbol.",
			}),
			scope: Type.Optional(
				Type.String({
					description: "Only use to search a specific subdirectory. Omit for cwd.",
				}),
			),
			kind: Type.Optional(
				Type.String({
					description: 'Search type: "symbol" (default), "content", "regex", "callers".',
				}),
			),
			expand: Type.Optional(
				Type.Number({
					description: "Number of top matches to expand with full source (default 2).",
				}),
			),
			context: Type.Optional(
				Type.String({
					description: "Path to file being edited — boosts nearby results. v1.0.1: Enhanced to prefer confirmed context targets.",
				}),
			),
			budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
		}),
		searchCompat,
		"Search for symbols, text, or regex in code. AST-aware definitions-first results. Evidence contract: prefer srcwalk before rg.",
	);

	registerTool(
		pi,
		"srcwalk_read",
		"Smart File Read",
		"Read a file with smart outlining. Replaces cat/head/tail. " +
			"Small files return full content. Large files return structural outline. " +
			'Use section for line ranges ("45-89") or symbol names. ' +
			'v0.4.0: path supports \"file:start-end\" shortcut for direct range reads. ' +
			"Use paths for batch reading (max 20 files). " +
			"v1.0.1: Supports comma-separated section targets and context lines.",
		Type.Object({
			path: Type.Optional(Type.String({ description: "File path to read." })),
			paths: Type.Optional(
				Type.Array(Type.String(), {
					description: "Multiple file paths for batch read.",
				}),
			),
			section: Type.Optional(
				Type.String({
					description: 'Line range "45-89", heading "## Architecture", or comma-separated targets "45-89, ## Config".',
				}),
			),
			full: Type.Optional(
				Type.Boolean({ description: "Force full content, bypass outlining." }),
			),
			contextLines: Type.Optional(
				Type.Number({
					description: "Number of context lines to show around matches (like grep -C). v1.0.1 feature.",
				}),
			),
			budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
		}),
		readCompat,
		"Read files with smart outlining — full content for small files, structural outline for large. Supports comma-separated sections and context lines (v1.0.1).",
	);

	registerTool(
		pi,
		"srcwalk_files",
		"Find Files",
		"Find files matching a glob pattern. Replaces find/ls/pwd. " +
			"Returns matched file paths with token size estimates, grouped by directory. Respects .gitignore. " +
			"v1.0.1: Enhanced discovery with improved guidance.",
		Type.Object({
			pattern: Type.String({
				description: 'Glob pattern: "*" (list dir), "*.rs", "src/**/*.ts".',
			}),
			scope: Type.Optional(
				Type.String({ description: "Directory to search. Omit for cwd." }),
			),
			budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
		}),
		filesCompat,
		"Find files by glob pattern with token size estimates. Respects .gitignore. Evidence contract: prefer srcwalk files over find/ls.",
	);

	registerTool(
		pi,
		"srcwalk_deps",
		"Blast Radius",
		"Blast-radius check before breaking changes. Shows what imports a file " +
			"and what calls its exports. v0.4.0: includes local relation groups and " +
			"outbound dependency previews for narrowed scopes. Use before changing " +
			"signatures, removing/renaming exports, or modifying behavior callers rely on. " +
			"v1.0.1: Enhanced dependency analysis with improved accuracy.",
		Type.Object({
			path: Type.String({
				description: "File to check before making breaking changes.",
			}),
			scope: Type.Optional(
				Type.String({ description: "Directory to search for dependents." }),
			),
			budget: Type.Optional(
				Type.Number({ description: "Max tokens. Truncates 'Used by' first." }),
			),
		}),
		depsCompat,
		"Blast-radius check — shows what imports a file and what calls its exports. v1.0.1: native dependency analysis.",
	);

	// ---- Native srcwalk tools -----------------------------------------------

	registerTool(
		pi,
		"srcwalk_map",
		"Repo Map",
		"Token-annotated directory skeleton with dependency-aware output (v0.4.0). " +
			"Respects .gitignore, .ignore, git excludes, and parent ignores. " +
			"Shows local relation groups and outbound dependency previews for narrowed scopes. " +
			"Use to understand repo shape, token budgets, and entry points before deep dives. " +
			"v1.0.1: Budget-adaptive inline symbol anchors.",
		Type.Object({
			scope: Type.Optional(
				Type.String({ description: "Directory to map. Omit for cwd." }),
			),
			depth: Type.Optional(
				Type.Number({ description: "Max directory depth (default 3)." }),
			),
			symbols: Type.Optional(
				Type.Boolean({
					description: "Show budget-adaptive inline symbol anchors (v1.0.1 feature).",
				}),
			),
			budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
		}),
		nativeMap,
		"Token-annotated repo map — understand codebase shape and token budgets at a glance. Supports budget-adaptive symbol anchors (v1.0.1).",
	);

	registerTool(
		pi,
		"srcwalk_callers",
		"Caller Graph",
		"Reverse call graph for a symbol. Supports multi-hop BFS (depth up to 5), " +
			"call-site filtering (e.g. 'args:3 receiver:mgr'), and aggregation by receiver or file. " +
			"Use for concrete call-site evidence. Prefer over srcwalk_search(kind: 'callers') " +
			"when you need depth, filters, or aggregation. " +
			"v1.0.1: Enhanced evidence contract — verify call graphs with context reads.",
		Type.Object({
			symbol: Type.String({ description: "Symbol name to trace callers of." }),
			scope: Type.Optional(
				Type.String({ description: "Directory to search." }),
			),
			depth: Type.Optional(
				Type.Number({ description: "BFS hop depth (default 1, max 5)." }),
			),
			filter: Type.Optional(
				Type.String({
					description:
						"Filter expression, e.g. 'args:3 receiver:mgr' or 'path:api'.",
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
		"Reverse call graph with multi-hop BFS, filters, and aggregation. Evidence contract: verify call graphs with context reads.",
	);

	registerTool(
		pi,
		"srcwalk_callees",
		"Callee Graph",
		"Forward call graph for a symbol — what does this function call? " +
			"Use --detailed for ordered call sites with argument slots and assignment context. " +
			"Use --depth for transitive downstream calls (up to available depth). " +
			"v1.0.1: Evidence contract — drill with detailed for argument-level context.",
		Type.Object({
			symbol: Type.String({ description: "Symbol name to trace callees of." }),
			scope: Type.Optional(
				Type.String({ description: "Directory to search." }),
			),
			depth: Type.Optional(
				Type.Number({ description: "Transitive depth (default 1)." }),
			),
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
		"Forward call graph — what does this function call, and with what arguments? Evidence contract: drill with detailed for argument context.",
	);

	registerTool(
		pi,
		"srcwalk_flow",
		"Flow Slice",
		"Compact orientation slice: ordered callees + selected local resolves + direct callers. " +
			"Good for quick understanding of a function's role in the call graph. " +
			"Nested/fluent chains may be collapsed — follow with srcwalk_callees or srcwalk_callers for depth. " +
			"v1.0.1: Evidence contract — first-pass orientation before deep dives.",
		Type.Object({
			symbol: Type.String({ description: "Symbol name to slice." }),
			scope: Type.Optional(
				Type.String({ description: "Directory to search." }),
			),
			filter: Type.Optional(
				Type.String({ description: "Filter expression, e.g. 'callee:validateToken'." }),
			),
			budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
		}),
		nativeFlow,
		"Compact function orientation slice — ordered calls + local resolves + callers. Evidence contract: first-pass orientation before deep dives.",
	);

	registerTool(
		pi,
		"srcwalk_impact",
		"Impact Triage",
		"Heuristic blast-radius triage for a symbol. Name-matched, not proof — " +
			"use as a broad starting point before verifying with srcwalk_callers or exact reads. " +
			"Common names like 'run', 'init', 'close' need follow-up with receiver/file groups. " +
			"v1.0.1: Evidence contract — triage first, then verify with callers.",
		Type.Object({
			symbol: Type.String({ description: "Symbol name to triage." }),
			scope: Type.Optional(
				Type.String({ description: "Directory to search." }),
			),
			budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
		}),
		nativeImpact,
		"Heuristic blast-radius triage — broad 'what might be affected?' starting point. Evidence contract: triage first, then verify with callers.",
	);
}
