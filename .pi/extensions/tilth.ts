/**
 * Tilth Extension — Code Intelligence Tool Compatibility Layer
 *
 * Preserves the existing `tilth_*` tool contract while allowing the backend
 * to be either:
 * - tilth MCP (`npx tilth --mcp`) — default
 * - srcwalk CLI (`srcwalk`) via `PI_CODE_NAV_BACKEND=srcwalk`
 *
 * TOOLS REGISTERED:
 *   - tilth_search — Symbol/content/regex/callers search (replaces grep)
 *   - tilth_read   — Smart file reading with structural outlines (replaces cat)
 *   - tilth_files  — Glob file finding with token estimates (replaces find/ls)
 *   - tilth_deps   — Blast-radius analysis before breaking changes
 *
 * OPTIONAL ENV:
 *   - PI_CODE_NAV_BACKEND=tilth|srcwalk
 *   - PI_SRCWALK_BIN=/absolute/path/to/srcwalk
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { createInterface, type Interface } from "node:readline";
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

interface CodeNavBackend {
	search(args: ToolArgs, signal?: AbortSignal): Promise<string>;
	read(args: ToolArgs, signal?: AbortSignal): Promise<string>;
	files(args: ToolArgs, signal?: AbortSignal): Promise<string>;
	deps(args: ToolArgs, signal?: AbortSignal): Promise<string>;
	shutdown(): void;
}

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

function resolveBackendMode(): "tilth" | "srcwalk" {
	return process.env.PI_CODE_NAV_BACKEND === "srcwalk" ? "srcwalk" : "tilth";
}

function resolveSrcwalkBin(): string {
	return process.env.PI_SRCWALK_BIN?.trim() || "srcwalk";
}

function toPosixPath(filePath: string): string {
	return filePath.split(path.sep).join("/");
}

function stripSourceExtension(filePath: string): string {
	const extension = path.extname(filePath);
	return SOURCE_FILE_EXTENSIONS.has(extension)
		? filePath.slice(0, -extension.length)
		: filePath;
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

function extractImportSpecifiers(source: string): Array<{ specifier: string; line: number }> {
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
		? importers.map(
				(importer) =>
					`- ${importer.file}:${importer.line} imports ${JSON.stringify(importer.specifier)}`,
			).join("\n")
		: "- No exact relative importers found in scope.";

	return [
		`# Blast radius: ${targetPath}`,
		"",
		"## Exact file importers",
		importerLines,
		"",
		"## srcwalk heuristic dependencies",
		"The section below is srcwalk's symbol-aware output. Treat `Used by` entries as heuristic call/export evidence; exact file importers above are the file-scoped import evidence.",
		"",
		rawDeps,
	].join("\n");
}

// ---------------------------------------------------------------------------
// tilth MCP backend
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number;
	result?: unknown;
	error?: { code: number; message: string };
}

class TilthMCPBackend implements CodeNavBackend {
	private proc: ChildProcess | null = null;
	private reader: Interface | null = null;
	private nextId = 1;
	private pending = new Map<
		number,
		{
			resolve: (v: JsonRpcResponse) => void;
			reject: (e: Error) => void;
		}
	>();
	private initialized = false;
	private editMode: boolean;

	constructor(editMode = false) {
		this.editMode = editMode;
	}

	private async ensureStarted(): Promise<void> {
		if (this.proc && !this.proc.killed) return;

		const args = ["tilth", "--mcp"];
		if (this.editMode) args.push("--edit");

		this.proc = spawn("npx", args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: buildSubprocessEnv("tilth"),
		});

		this.proc.on("error", (err) => {
			console.error("[tilth] Process error:", err.message);
			this.cleanup();
		});

		this.proc.on("exit", (code) => {
			if (code !== 0 && code !== null) {
				console.error(`[tilth] Process exited with code ${code}`);
			}
			this.cleanup();
		});

		this.reader = createInterface({ input: this.proc.stdout! });
		this.reader.on("line", (line: string) => {
			if (!line.trim()) return;
			try {
				const resp = JSON.parse(line) as JsonRpcResponse;
				const entry = this.pending.get(resp.id);
				if (entry) {
					this.pending.delete(resp.id);
					entry.resolve(resp);
				}
			} catch {
				// Ignore non-JSON lines.
			}
		});

		if (!this.initialized) {
			await this.send("initialize", {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "pi-tilth", version: "1.0.0" },
			});
			this.initialized = true;
		}
	}

	private async send(
		method: string,
		params?: Record<string, unknown>,
	): Promise<JsonRpcResponse> {
		await this.ensureStarted();

		const id = this.nextId++;
		const request: JsonRpcRequest = {
			jsonrpc: "2.0",
			id,
			method,
			...(params !== undefined && { params }),
		};

		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });

			const line = JSON.stringify(request) + "\n";
			this.proc!.stdin!.write(line, (err) => {
				if (err) {
					this.pending.delete(id);
					reject(new Error(`Failed to write to tilth: ${err.message}`));
				}
			});

			setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(new Error("tilth call timed out after 30s"));
				}
			}, DEFAULT_TIMEOUT_MS);
		});
	}

	private async callTool(name: string, args: ToolArgs): Promise<string> {
		const resp = await this.send("tools/call", { name, arguments: args });

		if (resp.error) {
			throw new Error(resp.error.message);
		}

		const result = resp.result as {
			content?: Array<{ type: string; text: string }>;
			isError?: boolean;
		};

		const text =
			result?.content
				?.filter((content) => content.type === "text")
				.map((content) => content.text)
				.join("\n") ?? "";

		if (result?.isError) {
			throw new Error(text || "tilth tool returned an error");
		}

		return text;
	}

	async search(args: ToolArgs): Promise<string> {
		return this.callTool("tilth_search", args);
	}

	async read(args: ToolArgs): Promise<string> {
		return this.callTool("tilth_read", args);
	}

	async files(args: ToolArgs): Promise<string> {
		return this.callTool("tilth_files", args);
	}

	async deps(args: ToolArgs): Promise<string> {
		return this.callTool("tilth_deps", args);
	}

	private cleanup(): void {
		for (const [, entry] of this.pending) {
			entry.reject(new Error("tilth process terminated"));
		}
		this.pending.clear();
		this.reader?.close();
		this.reader = null;
		this.proc = null;
		this.initialized = false;
	}

	shutdown(): void {
		if (this.proc && !this.proc.killed) {
			this.proc.kill("SIGTERM");
		}
		this.cleanup();
	}
}

// ---------------------------------------------------------------------------
// srcwalk CLI backend
// ---------------------------------------------------------------------------

class SrcwalkCLIBackend implements CodeNavBackend {
	private async run(args: string[], signal?: AbortSignal): Promise<string> {
		const srcwalkBin = resolveSrcwalkBin();

		return new Promise((resolve, reject) => {
			const child = execFile(
				srcwalkBin,
				args,
				{
					env: buildSubprocessEnv("tilth"),
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
									`srcwalk backend unavailable: binary \`${srcwalkBin}\` not found in PATH. Set PI_SRCWALK_BIN to override.`,
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

	private buildReadArgs(path: string, args: ToolArgs): string[] {
		const commandArgs = [path];
		const section = optionalString(args.section);
		const full = optionalBoolean(args.full);
		const budget = optionalNumber(args.budget);

		if (section) {
			commandArgs.push("--section", section);
		}
		if (full) {
			commandArgs.push("--full");
		}
		if (budget !== undefined) {
			commandArgs.push("--budget", String(budget));
		}

		return commandArgs;
	}

	async search(args: ToolArgs, signal?: AbortSignal): Promise<string> {
		const query = requireString(args.query, "query");
		const kind = optionalString(args.kind);
		const scope = optionalString(args.scope);
		const expand = optionalNumber(args.expand);
		const budget = optionalNumber(args.budget);
		const commandArgs = [kind === "callers" ? "callers" : "find", query];

		if (scope) {
			commandArgs.push("--scope", scope);
		}
		if (expand !== undefined) {
			commandArgs.push("--expand", String(expand));
		}
		if (budget !== undefined) {
			commandArgs.push("--budget", String(budget));
		}

		return this.run(commandArgs, signal);
	}

	async read(args: ToolArgs, signal?: AbortSignal): Promise<string> {
		const path = optionalString(args.path);
		const paths = readStringArray(args.paths, "paths");

		if (path && paths.length > 0) {
			throw new Error("Provide either `path` or `paths`, not both");
		}
		if (!path && paths.length === 0) {
			throw new Error("tilth_read requires `path` or `paths`");
		}

		if (path) {
			return this.run(this.buildReadArgs(path, args), signal);
		}

		const sections: string[] = [];
		for (const currentPath of paths) {
			const text = await this.run(this.buildReadArgs(currentPath, args), signal);
			sections.push(`## ${currentPath}\n\n${text}`);
		}

		return sections.join("\n\n---\n\n");
	}

	async files(args: ToolArgs, signal?: AbortSignal): Promise<string> {
		const pattern = requireString(args.pattern, "pattern");
		const scope = optionalString(args.scope);
		const budget = optionalNumber(args.budget);
		const commandArgs = ["files", pattern];

		if (scope) {
			commandArgs.push("--scope", scope);
		}
		if (budget !== undefined) {
			commandArgs.push("--budget", String(budget));
		}

		return this.run(commandArgs, signal);
	}

	async deps(args: ToolArgs, signal?: AbortSignal): Promise<string> {
		const targetPath = requireString(args.path, "path");
		const scope = optionalString(args.scope);
		const budget = optionalNumber(args.budget);
		const commandArgs = ["deps", targetPath];

		if (scope) {
			commandArgs.push("--scope", scope);
		}
		if (budget !== undefined) {
			commandArgs.push("--budget", String(budget));
		}

		const [rawDeps, importers] = await Promise.all([
			this.run(commandArgs, signal),
			findExactImporters(targetPath, scope),
		]);

		return formatDepsWithImporters(targetPath, rawDeps, importers);
	}

	shutdown(): void {
		// srcwalk commands are executed per call; nothing to clean up.
	}
}

function createBackend(): CodeNavBackend {
	return resolveBackendMode() === "srcwalk"
		? new SrcwalkCLIBackend()
		: new TilthMCPBackend(false);
}

// ---------------------------------------------------------------------------
// Tool registration helper
// ---------------------------------------------------------------------------

function registerTilthTool(
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
					content: [{ type: "text", text: `tilth error: ${msg}` }],
					details: {},
				};
			}
		},
	});
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function tilthExtension(pi: any): void {
	const backend = createBackend();

	registerTilthTool(
		pi,
		"tilth_search",
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
					description:
						"Only use to search a specific subdirectory. Omit for cwd.",
				}),
			),
			kind: Type.Optional(
				Type.String({
					description:
						'Search type: "symbol" (default), "content", "regex", "callers".',
				}),
			),
			expand: Type.Optional(
				Type.Number({
					description:
						"Number of top matches to expand with full source (default 2).",
				}),
			),
			context: Type.Optional(
				Type.String({
					description:
						"Path to file being edited — boosts nearby results.",
				}),
			),
			budget: Type.Optional(
				Type.Number({ description: "Max tokens in response." }),
			),
		}),
		(params, signal) => backend.search(params, signal),
		"Search for symbols, text, or regex in code. AST-aware definitions-first results.",
	);

	registerTilthTool(
		pi,
		"tilth_read",
		"Smart File Read",
		"Read a file with smart outlining. Replaces cat/head/tail. " +
			"Small files return full content. Large files return structural outline. " +
			'Use section for line ranges ("45-89") or headings ("## Architecture"). ' +
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
				Type.Boolean({
					description: "Force full content, bypass outlining.",
				}),
			),
			budget: Type.Optional(
				Type.Number({ description: "Max tokens in response." }),
			),
		}),
		(params, signal) => backend.read(params, signal),
		"Read files with smart outlining — full content for small files, structural outline for large.",
	);

	registerTilthTool(
		pi,
		"tilth_files",
		"Find Files",
		"Find files matching a glob pattern. Replaces find/ls/pwd. " +
			"Returns matched file paths with token size estimates. Respects .gitignore.",
		Type.Object({
			pattern: Type.String({
				description: 'Glob pattern: "*" (list dir), "*.rs", "src/**/*.ts".',
			}),
			scope: Type.Optional(
				Type.String({
					description: "Directory to search. Omit for cwd.",
				}),
			),
			budget: Type.Optional(
				Type.Number({ description: "Max tokens in response." }),
			),
		}),
		(params, signal) => backend.files(params, signal),
		"Find files by glob pattern with token size estimates. Respects .gitignore.",
	);

	registerTilthTool(
		pi,
		"tilth_deps",
		"Blast Radius",
		"Blast-radius check before breaking changes. Shows what imports a file " +
			"and what calls its exports. Use ONLY when changing signatures, " +
			"removing/renaming exports, or modifying behavior callers rely on.",
		Type.Object({
			path: Type.String({
				description: "File to check before making breaking changes.",
			}),
			scope: Type.Optional(
				Type.String({
					description: "Directory to search for dependents.",
				}),
			),
			budget: Type.Optional(
				Type.Number({
					description: "Max tokens. Truncates 'Used by' first.",
				}),
			),
		}),
		(params, signal) => backend.deps(params, signal),
		"Blast-radius check — shows what imports a file and calls its exports.",
	);

	pi.on("session_shutdown", () => {
		backend.shutdown();
	});
}
