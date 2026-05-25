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

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { buildSubprocessEnv } from "./security/env-policy.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const SOURCE_FILE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
]);
const SKIP_SCAN_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"coverage",
	".next",
]);
const MAX_IMPORT_SCAN_FILES = 2_000;

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

function toPosixPath(filePath: string): string {
	return filePath.split(path.sep).join("/");
}

function stripSourceExtension(filePath: string): string {
	const ext = path.extname(filePath);
	return SOURCE_FILE_EXTENSIONS.has(ext) ? filePath.slice(0, -ext.length) : filePath;
}

function isSourceFile(filePath: string): boolean {
	return SOURCE_FILE_EXTENSIONS.has(path.extname(filePath));
}

async function collectSourceFiles(
	rootDir: string,
	result: string[] = [],
): Promise<string[]> {
	if (result.length >= MAX_IMPORT_SCAN_FILES) return result;

	let entries;
	try {
		entries = await readdir(rootDir, { withFileTypes: true });
	} catch {
		return result;
	}

	for (const entry of entries) {
		if (result.length >= MAX_IMPORT_SCAN_FILES) break;
		if (entry.name.startsWith(".") && entry.name !== ".pi") continue;

		const entryPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_SCAN_DIRS.has(entry.name)) {
				await collectSourceFiles(entryPath, result);
			}
			continue;
		}
		if (entry.isFile() && isSourceFile(entry.name)) {
			result.push(entryPath);
		}
	}

	return result;
}

function extractImportSpecifiers(
	source: string,
): Array<{ specifier: string; line: number }> {
	const results: Array<{ specifier: string; line: number }> = [];
	const importPattern =
		/\b(?:import|export)\s+(?:type\s+)?(?:[^"'()]*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
	let match: RegExpExecArray | null;
	while ((match = importPattern.exec(source)) !== null) {
		const specifier = match[1] ?? match[2] ?? match[3];
		if (!specifier?.startsWith(".")) continue;
		const line = source.slice(0, match.index).split("\n").length;
		results.push({ specifier, line });
	}
	return results;
}

function resolvesToTarget(
	importerPath: string,
	specifier: string,
	targetAbsPath: string,
): boolean {
	const resolved = path.resolve(path.dirname(importerPath), specifier);
	return stripSourceExtension(resolved) === stripSourceExtension(targetAbsPath);
}

async function findExactImporters(
	targetPath: string,
	scope?: string,
): Promise<Array<{ file: string; line: number; specifier: string }>> {
	const cwd = process.cwd();
	const targetAbsPath = path.resolve(cwd, targetPath);
	const scanRoot = path.resolve(cwd, scope ?? ".");
	const sourceFiles = await collectSourceFiles(scanRoot);
	const results: Array<{ file: string; line: number; specifier: string }> = [];

	for (const filePath of sourceFiles) {
		if (stripSourceExtension(filePath) === stripSourceExtension(targetAbsPath)) {
			continue;
		}
		let source: string;
		try {
			source = await readFile(filePath, "utf8");
		} catch {
			continue;
		}
		for (const { specifier, line } of extractImportSpecifiers(source)) {
			if (resolvesToTarget(filePath, specifier, targetAbsPath)) {
				results.push({
					file: toPosixPath(path.relative(cwd, filePath)),
					line,
					specifier,
				});
			}
		}
	}

	return results;
}

function formatDepsWithImporters(
	targetPath: string,
	rawDeps: string,
	importers: Array<{ file: string; line: number; specifier: string }>,
): string {
	const importerLines = importers.length
		? importers
				.map((i) => `- ${i.file}:${i.line} imports ${JSON.stringify(i.specifier)}`)
				.join("\n")
		: "- No exact relative importers found in scope.";

	return [
		`# Blast radius: ${targetPath}`,
		"",
		"## Exact file importers",
		importerLines,
		"",
		"## srcwalk heuristic dependencies",
		"The section below is srcwalk's symbol-aware output. Treat `Used by` entries as " +
			"heuristic call/export evidence; exact file importers above are file-scoped import evidence.",
		"",
		rawDeps,
	].join("\n");
}

// ---------------------------------------------------------------------------
// Core srcwalk runner
// ---------------------------------------------------------------------------

function run(args: string[], signal?: AbortSignal): Promise<string> {
	const srcwalkBin = resolveSrcwalkBin();

	return new Promise((resolve, reject) => {
		const child = execFile(
			srcwalkBin,
			args,
			{
				env: buildSubprocessEnv("srcwalk"),
				timeout: DEFAULT_TIMEOUT_MS,
				maxBuffer: MAX_BUFFER_BYTES,
				signal,
			},
			(error, stdout, stderr) => {
				if (error) {
					if (isAbortError(error)) {
						reject(new DOMException("Cancelled", "AbortError"));
						return;
					}
					if ((error as NodeJS.ErrnoException).code === "ENOENT") {
						reject(
							new Error(
								`srcwalk binary \`${srcwalkBin}\` not found on PATH. ` +
									`Install via: npm install -g srcwalk  or  cargo install srcwalk --locked\n` +
									`Or set PI_SRCWALK_BIN to override, e.g. PI_SRCWALK_BIN=$HOME/.cargo/bin/srcwalk`,
							),
						);
						return;
					}
					const stderrText = (stderr || "").trim();
					reject(
						new Error(
							stderrText ||
								error.message ||
								`srcwalk failed: ${srcwalkBin} ${args.join(" ")}`,
						),
					);
					return;
				}
				resolve((stdout || "").trim());
			},
		);

		if (signal) {
			const onAbort = () => {
				try {
					child.kill("SIGTERM");
				} catch {
					// best effort
				}
			};
			signal.addEventListener("abort", onAbort, { once: true });
		}
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
	if (section) cmdArgs.push("--section", section);
	if (full) cmdArgs.push("--full");
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

	const [rawDeps, importers] = await Promise.all([
		run(cmdArgs, signal),
		findExactImporters(targetPath, scope),
	]);
	return formatDepsWithImporters(targetPath, rawDeps, importers);
}

// ---------------------------------------------------------------------------
// Native srcwalk tool implementations
// ---------------------------------------------------------------------------

async function nativeMap(args: ToolArgs, signal?: AbortSignal): Promise<string> {
	const scope = optionalString(args.scope);
	const depth = optionalNumber(args.depth);
	const cmdArgs = ["overview"];
	if (scope) cmdArgs.push("--scope", scope);
	if (depth !== undefined) cmdArgs.push("--depth", String(depth));
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

function registerTool(
	pi: any,
	name: string,
	label: string,
	description: string,
	parameters: any,
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
			signal: AbortSignal,
			_onUpdate: (text: string) => void,
			_ctx: any,
		) {
			try {
				const text = await executor(params, signal);
				return { content: [{ type: "text", text }], details: {} };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `srcwalk error: ${msg}` }],
					details: {},
				};
			}
		},
	});
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function srcwalkExtension(pi: any): void {
	// ---- Core srcwalk_* navigation tools ----------------------------------

	registerTool(
		pi,
		"srcwalk_search",
		"Code Search",
		"Search for symbols, text, or regex patterns in code. Replaces grep/rg. " +
			"Symbol search returns definitions first (via tree-sitter AST), then usages, " +
			"with full source code inlined for top matches. " +
			"For cross-file tracing, pass comma-separated symbol names (max 5).",
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
					description: "Path to file being edited — boosts nearby results.",
				}),
			),
			budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
		}),
		searchCompat,
		"Search for symbols, text, or regex in code. AST-aware definitions-first results.",
	);

	registerTool(
		pi,
		"srcwalk_read",
		"Smart File Read",
		"Read a file with smart outlining. Replaces cat/head/tail. " +
			"Small files return full content. Large files return structural outline. " +
			'Use section for line ranges ("45-89") or symbol names. ' +
			'v0.4.0: path supports \"file:start-end\" shortcut for direct range reads. ' +
			"Use paths for batch reading (max 20 files).",
		Type.Object({
			path: Type.Optional(Type.String({ description: "File path to read." })),
			paths: Type.Optional(
				Type.Array(Type.String(), {
					description: "Multiple file paths for batch read.",
				}),
			),
			section: Type.Optional(
				Type.String({
					description: 'Line range "45-89" or heading "## Architecture".',
				}),
			),
			full: Type.Optional(
				Type.Boolean({ description: "Force full content, bypass outlining." }),
			),
			budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
		}),
		readCompat,
		"Read files with smart outlining — full content for small files, structural outline for large.",
	);

	registerTool(
		pi,
		"srcwalk_files",
		"Find Files",
		"Find files matching a glob pattern. Replaces find/ls/pwd. " +
			"Returns matched file paths with token size estimates, grouped by directory. Respects .gitignore.",
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
		"Find files by glob pattern with token size estimates. Respects .gitignore.",
	);

	registerTool(
		pi,
		"srcwalk_deps",
		"Blast Radius",
		"Blast-radius check before breaking changes. Shows what imports a file " +
			"and what calls its exports. v0.4.0: includes local relation groups and " +
			"outbound dependency previews for narrowed scopes. Use before changing " +
			"signatures, removing/renaming exports, or modifying behavior callers rely on.",
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
		"Blast-radius check — shows what imports a file and calls its exports.",
	);

	// ---- Native srcwalk tools -----------------------------------------------

	registerTool(
		pi,
		"srcwalk_map",
		"Repo Map",
		"Token-annotated directory skeleton with dependency-aware output (v0.4.0). " +
			"Respects .gitignore, .ignore, git excludes, and parent ignores. " +
			"Shows local relation groups and outbound dependency previews for narrowed scopes. " +
			"Use to understand repo shape, token budgets, and entry points before deep dives.",
		Type.Object({
			scope: Type.Optional(
				Type.String({ description: "Directory to map. Omit for cwd." }),
			),
			depth: Type.Optional(
				Type.Number({ description: "Max directory depth (default 3)." }),
			),
			budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
		}),
		nativeMap,
		"Token-annotated repo map — understand codebase shape and token budgets at a glance.",
	);

	registerTool(
		pi,
		"srcwalk_callers",
		"Caller Graph",
		"Reverse call graph for a symbol. Supports multi-hop BFS (depth up to 5), " +
			"call-site filtering (e.g. 'args:3 receiver:mgr'), and aggregation by receiver or file. " +
			"Use for concrete call-site evidence. Prefer over srcwalk_search(kind: 'callers') " +
			"when you need depth, filters, or aggregation.",
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
		"Reverse call graph with multi-hop BFS, filters, and aggregation.",
	);

	registerTool(
		pi,
		"srcwalk_callees",
		"Callee Graph",
		"Forward call graph for a symbol — what does this function call? " +
			"Use --detailed for ordered call sites with argument slots and assignment context. " +
			"Use --depth for transitive downstream calls (up to available depth).",
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
		"Forward call graph — what does this function call, and with what arguments?",
	);

	registerTool(
		pi,
		"srcwalk_flow",
		"Flow Slice",
		"Compact orientation slice: ordered callees + selected local resolves + direct callers. " +
			"Good for quick understanding of a function's role in the call graph. " +
			"Nested/fluent chains may be collapsed — follow with srcwalk_callees or srcwalk_callers for depth.",
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
		"Compact function orientation slice — ordered calls + local resolves + callers.",
	);

	registerTool(
		pi,
		"srcwalk_impact",
		"Impact Triage",
		"Heuristic blast-radius triage for a symbol. Name-matched, not proof — " +
			"use as a broad starting point before verifying with srcwalk_callers or exact reads. " +
			"Common names like 'run', 'init', 'close' need follow-up with receiver/file groups.",
		Type.Object({
			symbol: Type.String({ description: "Symbol name to triage." }),
			scope: Type.Optional(
				Type.String({ description: "Directory to search." }),
			),
			budget: Type.Optional(Type.Number({ description: "Max tokens in response." })),
		}),
		nativeImpact,
		"Heuristic blast-radius triage — broad 'what might be affected?' starting point.",
	);
}
