/**
 * Tilth Extension — Code Intelligence MCP Proxy
 *
 * Spawns `tilth --mcp` as a subprocess and proxies its tools to the pi agent.
 * Tilth is a Rust MCP server providing AST-aware code search, smart file reading,
 * glob file finding, and blast-radius analysis via tree-sitter.
 *
 * TOOLS REGISTERED:
 *   - tilth_search — Symbol/content/regex/callers search (replaces grep)
 *   - tilth_read   — Smart file reading with structural outlines (replaces cat)
 *   - tilth_files  — Glob file finding with token estimates (replaces find/ls)
 *   - tilth_deps   — Blast-radius check before breaking changes
 *
 * REQUIRES:
 *   `npx tilth` or `cargo install tilth` (Rust binary)
 *
 * The subprocess is long-lived — started on first tool call, reused across calls,
 * and killed on session shutdown.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { Type } from "@sinclair/typebox";
import { createInterface, type Interface } from "node:readline";

// ---------------------------------------------------------------------------
// MCP JSON-RPC client for subprocess communication
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

class TilthMCPClient {
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
			env: { ...process.env },
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

		// Read JSON-RPC responses line by line from stdout
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
				// Ignore non-JSON lines (e.g. stderr bleeding through)
			}
		});

		// Initialize MCP protocol
		if (!this.initialized) {
			await this.send("initialize", {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "pi-tilth", version: "1.0.0" },
			});
			this.initialized = true;
		}
	}

	async send(
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

			// Timeout after 30s
			setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(new Error("tilth call timed out after 30s"));
				}
			}, 30_000);
		});
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<string> {
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
				?.filter((c) => c.type === "text")
				.map((c) => c.text)
				.join("\n") ?? "";

		if (result?.isError) {
			throw new Error(text || "tilth tool returned an error");
		}

		return text;
	}

	private cleanup(): void {
		for (const [id, entry] of this.pending) {
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
// Tool registration helper
// ---------------------------------------------------------------------------

function registerTilthTool(
	pi: any,
	client: TilthMCPClient,
	name: string,
	label: string,
	description: string,
	parameters: any,
): void {
	pi.registerTool({
		name,
		label,
		description,
		parameters,
		async execute(
			_toolCallId: string,
			params: Record<string, unknown>,
			_signal: AbortSignal,
			_onUpdate: (text: string) => void,
			_ctx: any,
		) {
			try {
				const text = await client.callTool(name, params);
				return { content: [{ type: "text", text }], details: {} };
			} catch (err) {
				const msg =
					err instanceof Error ? err.message : String(err);
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
	const client = new TilthMCPClient(false);

	// --- tilth_search ---
	registerTilthTool(
		pi,
		client,
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
	);

	// --- tilth_read ---
	registerTilthTool(
		pi,
		client,
		"tilth_read",
		"Smart File Read",
		"Read a file with smart outlining. Replaces cat/head/tail. " +
			"Small files return full content. Large files return structural outline. " +
			'Use section for line ranges ("45-89") or headings ("## Architecture"). ' +
			"Use paths for batch reading (max 20 files).",
		Type.Object({
			path: Type.Optional(
				Type.String({ description: "File path to read." }),
			),
			paths: Type.Optional(
				Type.Array(Type.String(), {
					description: "Multiple file paths for batch read.",
				}),
			),
			section: Type.Optional(
				Type.String({
					description:
						'Line range "45-89" or heading "## Architecture".',
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
	);

	// --- tilth_files ---
	registerTilthTool(
		pi,
		client,
		"tilth_files",
		"Find Files",
		"Find files matching a glob pattern. Replaces find/ls/pwd. " +
			"Returns matched file paths with token size estimates. Respects .gitignore.",
		Type.Object({
			pattern: Type.String({
				description:
					'Glob pattern: "*" (list dir), "*.rs", "src/**/*.ts".',
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
	);

	// --- tilth_deps ---
	registerTilthTool(
		pi,
		client,
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
	);

	// --- Cleanup ---
	pi.on("session_shutdown", () => {
		client.shutdown();
	});
}
