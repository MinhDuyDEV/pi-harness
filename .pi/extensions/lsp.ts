/**
 * LSP Tools Extension — Language Server Protocol integration for Pi.
 * Ported from OpenCode's lsp tool. Provides type-aware code intelligence
 * that goes beyond tree-sitter AST: actual go-to-definition across imports,
 * find-all-references with type resolution, call hierarchy, hover type info.
 *
 * Supports: TypeScript, Go, Rust, Python (auto-detected from project files).
 * LSP servers are spawned lazily on first use and reused across tool calls.
 *
 * Tools:
 *   - lsp_definition:       Go to definition of symbol at position
 *   - lsp_references:       Find all references to symbol at position
 *   - lsp_hover:            Get type info / documentation at position
 *   - lsp_symbols:          List all symbols in a file
 *   - lsp_workspace_symbols: Search symbols across the project
 *   - lsp_call_hierarchy:   Show incoming/outgoing calls for a function
 *
 * DEPENDENCIES:
 *   npm install vscode-jsonrpc vscode-languageserver-protocol
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// LSP Protocol Types (minimal, avoiding full vscode-languageserver-protocol)
// ---------------------------------------------------------------------------

interface Position {
	line: number;
	character: number;
}
interface Range {
	start: Position;
	end: Position;
}
interface Location {
	uri: string;
	range: Range;
}
interface TextDocumentIdentifier {
	uri: string;
}
interface TextDocumentPositionParams {
	textDocument: TextDocumentIdentifier;
	position: Position;
}

// ---------------------------------------------------------------------------
// JSON-RPC over stdio transport
// ---------------------------------------------------------------------------

class JsonRpcTransport {
	private buffer = "";
	private pendingRequests = new Map<
		number,
		{ resolve: (value: any) => void; reject: (err: Error) => void }
	>();
	private nextId = 1;
	private process: ChildProcess;

	constructor(proc: ChildProcess) {
		this.process = proc;

		proc.stdout!.on("data", (chunk: Buffer) => {
			this.buffer += chunk.toString();
			this.processBuffer();
		});

		proc.stderr!.on("data", (chunk: Buffer) => {
			// LSP servers may log to stderr — silently ignore
		});

		proc.on("exit", () => {
			for (const [, { reject }] of this.pendingRequests) {
				reject(new Error("LSP server exited"));
			}
			this.pendingRequests.clear();
		});
	}

	private processBuffer(): void {
		while (true) {
			const headerEnd = this.buffer.indexOf("\r\n\r\n");
			if (headerEnd === -1) return;

			const header = this.buffer.slice(0, headerEnd);
			const match = header.match(/Content-Length:\s*(\d+)/i);
			if (!match) {
				this.buffer = this.buffer.slice(headerEnd + 4);
				continue;
			}

			const contentLength = parseInt(match[1], 10);
			const contentStart = headerEnd + 4;
			if (this.buffer.length < contentStart + contentLength) return;

			const content = this.buffer.slice(
				contentStart,
				contentStart + contentLength,
			);
			this.buffer = this.buffer.slice(contentStart + contentLength);

			try {
				const message = JSON.parse(content);
				if (message.id !== undefined && this.pendingRequests.has(message.id)) {
					const { resolve, reject } = this.pendingRequests.get(message.id)!;
					this.pendingRequests.delete(message.id);
					if (message.error) {
						reject(
							new Error(message.error.message ?? JSON.stringify(message.error)),
						);
					} else {
						resolve(message.result);
					}
				}
				// Notifications and server-initiated requests are silently ignored
			} catch {
				// Malformed JSON — skip
			}
		}
	}

	async request(method: string, params: any, timeoutMs = 15_000): Promise<any> {
		const id = this.nextId++;
		const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });
		const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`LSP request timed out: ${method}`));
			}, timeoutMs);

			this.pendingRequests.set(id, {
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value);
				},
				reject: (err) => {
					clearTimeout(timer);
					reject(err);
				},
			});

			this.process.stdin!.write(header + message);
		});
	}

	notify(method: string, params: any): void {
		const message = JSON.stringify({ jsonrpc: "2.0", method, params });
		const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
		this.process.stdin!.write(header + message);
	}

	kill(): void {
		try {
			this.process.kill();
		} catch {
			// Already dead
		}
	}
}

// ---------------------------------------------------------------------------
// LSP Client
// ---------------------------------------------------------------------------

interface ServerConfig {
	command: string;
	args: string[];
	detect: (cwd: string) => boolean;
	languageId: string;
	extensions: string[];
}

const SERVER_CONFIGS: Record<string, ServerConfig> = {
	typescript: {
		command: "typescript-language-server",
		args: ["--stdio"],
		detect: (cwd) =>
			existsSync(path.join(cwd, "tsconfig.json")) ||
			existsSync(path.join(cwd, "package.json")),
		languageId: "typescript",
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
	},
	go: {
		command: "gopls",
		args: ["serve"],
		detect: (cwd) => existsSync(path.join(cwd, "go.mod")),
		languageId: "go",
		extensions: [".go"],
	},
	rust: {
		command: "rust-analyzer",
		args: [],
		detect: (cwd) => existsSync(path.join(cwd, "Cargo.toml")),
		languageId: "rust",
		extensions: [".rs"],
	},
	python: {
		command: "pyright-langserver",
		args: ["--stdio"],
		detect: (cwd) =>
			existsSync(path.join(cwd, "pyproject.toml")) ||
			existsSync(path.join(cwd, "setup.py")) ||
			existsSync(path.join(cwd, "requirements.txt")),
		languageId: "python",
		extensions: [".py"],
	},
};

class LSPClient {
	private transport: JsonRpcTransport | null = null;
	private config: ServerConfig;
	private rootUri: string;
	private initialized = false;
	private openDocs = new Set<string>();

	constructor(config: ServerConfig, rootPath: string) {
		this.config = config;
		this.rootUri = pathToFileURL(rootPath).toString();
	}

	async start(): Promise<void> {
		const proc = spawn(this.config.command, this.config.args, {
			stdio: ["pipe", "pipe", "pipe"],
			cwd: this.rootUri.replace("file://", ""),
		});

		if (!proc.pid) {
			throw new Error(
				`Failed to spawn LSP server: ${this.config.command}. Is it installed?`,
			);
		}

		this.transport = new JsonRpcTransport(proc);

		// Initialize handshake
		const initResult = await this.transport.request("initialize", {
			processId: process.pid,
			rootUri: this.rootUri,
			capabilities: {
				textDocument: {
					definition: { dynamicRegistration: false },
					references: { dynamicRegistration: false },
					hover: {
						dynamicRegistration: false,
						contentFormat: ["markdown", "plaintext"],
					},
					documentSymbol: { dynamicRegistration: false },
					callHierarchy: { dynamicRegistration: false },
				},
				workspace: {
					symbol: { dynamicRegistration: false },
				},
			},
		}, 30_000);

		this.transport.notify("initialized", {});
		this.initialized = true;

		return initResult;
	}

	async openDocument(filePath: string): Promise<void> {
		if (!this.transport || !this.initialized) return;
		const uri = pathToFileURL(filePath).toString();
		if (this.openDocs.has(uri)) return;

		try {
			const content = readFileSync(filePath, "utf-8");
			this.transport.notify("textDocument/didOpen", {
				textDocument: {
					uri,
					languageId: this.config.languageId,
					version: 1,
					text: content,
				},
			});
			this.openDocs.add(uri);
		} catch {
			// File may not exist
		}
	}

	async definition(
		filePath: string,
		line: number,
		character: number,
	): Promise<Location[]> {
		await this.openDocument(filePath);
		const result = await this.transport!.request(
			"textDocument/definition",
			{
				textDocument: { uri: pathToFileURL(filePath).toString() },
				position: { line, character },
			},
		);
		return normalizeLocations(result);
	}

	async references(
		filePath: string,
		line: number,
		character: number,
	): Promise<Location[]> {
		await this.openDocument(filePath);
		const result = await this.transport!.request(
			"textDocument/references",
			{
				textDocument: { uri: pathToFileURL(filePath).toString() },
				position: { line, character },
				context: { includeDeclaration: true },
			},
		);
		return normalizeLocations(result);
	}

	async hover(
		filePath: string,
		line: number,
		character: number,
	): Promise<string | null> {
		await this.openDocument(filePath);
		const result = await this.transport!.request("textDocument/hover", {
			textDocument: { uri: pathToFileURL(filePath).toString() },
			position: { line, character },
		});

		if (!result?.contents) return null;
		const contents = result.contents;
		if (typeof contents === "string") return contents;
		if (contents.value) return contents.value;
		if (Array.isArray(contents))
			return contents
				.map((c: any) => (typeof c === "string" ? c : c.value ?? ""))
				.join("\n");
		return JSON.stringify(contents);
	}

	async documentSymbols(filePath: string): Promise<any[]> {
		await this.openDocument(filePath);
		const result = await this.transport!.request(
			"textDocument/documentSymbol",
			{
				textDocument: { uri: pathToFileURL(filePath).toString() },
			},
		);
		return result ?? [];
	}

	async workspaceSymbols(query: string): Promise<any[]> {
		const result = await this.transport!.request("workspace/symbol", {
			query,
		});
		return result ?? [];
	}

	async callHierarchy(
		filePath: string,
		line: number,
		character: number,
		direction: "incoming" | "outgoing",
	): Promise<any[]> {
		await this.openDocument(filePath);

		const items = await this.transport!.request(
			"textDocument/prepareCallHierarchy",
			{
				textDocument: { uri: pathToFileURL(filePath).toString() },
				position: { line, character },
			},
		);

		if (!items || items.length === 0) return [];

		const method =
			direction === "incoming"
				? "callHierarchy/incomingCalls"
				: "callHierarchy/outgoingCalls";

		const calls = await this.transport!.request(method, { item: items[0] });
		return calls ?? [];
	}

	shutdown(): void {
		if (this.transport) {
			try {
				this.transport.request("shutdown", null, 3000).catch(() => {});
				this.transport.notify("exit", null);
			} catch {
				// Best effort
			}
			setTimeout(() => this.transport?.kill(), 2000);
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeLocations(result: any): Location[] {
	if (!result) return [];
	if (Array.isArray(result)) return result;
	if (result.uri) return [result]; // Single Location
	if (result.targetUri) {
		// LocationLink
		return [{ uri: result.targetUri, range: result.targetRange }];
	}
	return [];
}

function uriToPath(uri: string): string {
	try {
		return new URL(uri).pathname;
	} catch {
		return uri;
	}
}

function formatLocations(locations: Location[], label: string): string {
	if (locations.length === 0) return `No ${label} found.`;

	const lines = [`Found ${locations.length} ${label}:\n`];
	for (const loc of locations.slice(0, 30)) {
		const filePath = uriToPath(loc.uri);
		const line = loc.range.start.line + 1; // Convert to 1-based
		const char = loc.range.start.character + 1;
		lines.push(`  ${filePath}:${line}:${char}`);
	}
	if (locations.length > 30) {
		lines.push(`  ... and ${locations.length - 30} more`);
	}
	return lines.join("\n");
}

const SYMBOL_KIND_NAMES: Record<number, string> = {
	1: "File",
	2: "Module",
	3: "Namespace",
	4: "Package",
	5: "Class",
	6: "Method",
	7: "Property",
	8: "Field",
	9: "Constructor",
	10: "Enum",
	11: "Interface",
	12: "Function",
	13: "Variable",
	14: "Constant",
	15: "String",
	16: "Number",
	17: "Boolean",
	18: "Array",
	19: "Object",
	20: "Key",
	21: "Null",
	22: "EnumMember",
	23: "Struct",
	24: "Event",
	25: "Operator",
	26: "TypeParameter",
};

function formatSymbols(symbols: any[], indent = 0): string {
	const lines: string[] = [];
	for (const sym of symbols) {
		const kind = SYMBOL_KIND_NAMES[sym.kind] ?? `Kind(${sym.kind})`;
		const prefix = "  ".repeat(indent);
		const loc = sym.range ?? sym.location?.range;
		const line = loc ? `:${loc.start.line + 1}` : "";
		lines.push(`${prefix}${kind} ${sym.name}${line}`);

		// Recurse into children (DocumentSymbol format)
		if (sym.children?.length > 0) {
			lines.push(formatSymbols(sym.children, indent + 1));
		}
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function lspExtension(pi: any): void {
	const clients = new Map<string, LSPClient>();
	let projectRoot = process.cwd();

	function getLanguageForFile(filePath: string): string | null {
		const ext = path.extname(filePath).toLowerCase();
		for (const [lang, config] of Object.entries(SERVER_CONFIGS)) {
			if (config.extensions.includes(ext)) return lang;
		}
		return null;
	}

	function findProjectRoot(filePath: string, config: ServerConfig): string | null {
		let dir = path.dirname(filePath);
		const root = path.parse(dir).root;
		while (dir !== root) {
			if (config.detect(dir)) return dir;
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
		return null;
	}

	async function getClient(filePath: string): Promise<LSPClient> {
		const lang = getLanguageForFile(filePath);
		if (!lang) throw new Error(`No LSP server configured for ${path.extname(filePath)} files`);

		if (clients.has(lang)) return clients.get(lang)!;

		const config = SERVER_CONFIGS[lang];

		// Walk up from file to find project root (where config file lives)
		let root = findProjectRoot(filePath, config);
		if (!root) {
			// Fall back to cwd
			if (config.detect(projectRoot)) {
				root = projectRoot;
			} else {
				throw new Error(
					`${lang} LSP not applicable — no project config found for ${filePath}`,
				);
			}
		}

		const client = new LSPClient(config, root);
		try {
			await client.start();
		} catch (err) {
			throw new Error(
				`Failed to start ${config.command}: ${err instanceof Error ? err.message : String(err)}. Is it installed? (npm i -g ${config.command})`,
			);
		}
		clients.set(lang, client);

		// Give the server a moment to index
		await new Promise((r) => setTimeout(r, 1500));
		return client;
	}

	// Shared parameter schemas
	const FileLineParams = Type.Object({
		filePath: Type.String({
			description: "Absolute path to the file",
		}),
		line: Type.Number({
			description: "Line number (1-based)",
		}),
		character: Type.Number({
			description: "Character offset (1-based)",
		}),
	});

	// -------------------------------------------------------------------------
	// lsp_definition
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "lsp_definition",
		label: "Go to Definition",
		description:
			"Jump to the definition of a symbol at a given position. Uses the language server for type-aware resolution — works across files and through imports.",
		parameters: FileLineParams,
		async execute(
			_id: string,
			params: { filePath: string; line: number; character: number },
		) {
			try {
				const client = await getClient(params.filePath);
				const locations = await client.definition(
					params.filePath,
					params.line - 1, // Convert to 0-based
					params.character - 1,
				);
				return {
					content: [
						{ type: "text", text: formatLocations(locations, "definitions") },
					],
					details: {},
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `LSP error: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					details: {},
				};
			}
		},
	});

	// -------------------------------------------------------------------------
	// lsp_references
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "lsp_references",
		label: "Find References",
		description:
			"Find all references to a symbol at a given position. Type-aware — only finds actual usages of the same symbol, not just text matches.",
		parameters: FileLineParams,
		async execute(
			_id: string,
			params: { filePath: string; line: number; character: number },
		) {
			try {
				const client = await getClient(params.filePath);
				const locations = await client.references(
					params.filePath,
					params.line - 1,
					params.character - 1,
				);
				return {
					content: [
						{ type: "text", text: formatLocations(locations, "references") },
					],
					details: {},
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `LSP error: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					details: {},
				};
			}
		},
	});

	// -------------------------------------------------------------------------
	// lsp_hover
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "lsp_hover",
		label: "Hover Info",
		description:
			"Get type information and documentation for a symbol at a given position. Shows type signatures, JSDoc comments, and inferred types.",
		parameters: FileLineParams,
		async execute(
			_id: string,
			params: { filePath: string; line: number; character: number },
		) {
			try {
				const client = await getClient(params.filePath);
				const info = await client.hover(
					params.filePath,
					params.line - 1,
					params.character - 1,
				);
				return {
					content: [
						{ type: "text", text: info ?? "No hover information available." },
					],
					details: {},
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `LSP error: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					details: {},
				};
			}
		},
	});

	// -------------------------------------------------------------------------
	// lsp_symbols
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "lsp_symbols",
		label: "Document Symbols",
		description:
			"List all symbols (functions, classes, variables, types) in a file. Provides a structural overview with hierarchy.",
		parameters: Type.Object({
			filePath: Type.String({
				description: "Absolute path to the file",
			}),
		}),
		async execute(_id: string, params: { filePath: string }) {
			try {
				const client = await getClient(params.filePath);
				const symbols = await client.documentSymbols(params.filePath);
				if (symbols.length === 0) {
					return {
						content: [{ type: "text", text: "No symbols found." }],
						details: {},
					};
				}
				return {
					content: [{ type: "text", text: formatSymbols(symbols) }],
					details: {},
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `LSP error: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					details: {},
				};
			}
		},
	});

	// -------------------------------------------------------------------------
	// lsp_workspace_symbols
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "lsp_workspace_symbols",
		label: "Workspace Symbols",
		description:
			"Search for symbols across the entire project. Type-aware — finds functions, classes, interfaces, types by name.",
		parameters: Type.Object({
			query: Type.String({
				description:
					"Symbol name or pattern to search for (e.g. 'handleRequest', 'User')",
			}),
		}),
		async execute(_id: string, params: { query: string }) {
			try {
				// Try to find any applicable LSP client
				let client: LSPClient | null = null;
				for (const [, c] of clients) {
					client = c;
					break;
				}

				if (!client) {
					// Try to start one based on project detection
					for (const [, config] of Object.entries(SERVER_CONFIGS)) {
						if (config.detect(projectRoot)) {
							// Create a dummy file path to trigger client creation
							const ext = config.extensions[0];
							const dummyPath = path.join(projectRoot, `__lsp_probe${ext}`);
							try {
								client = await getClient(dummyPath);
								break;
							} catch {
								continue;
							}
						}
					}
				}

				if (!client) {
					return {
						content: [
							{
								type: "text",
								text: "No LSP server available. Open a source file first.",
							},
						],
						details: {},
					};
				}

				const symbols = await client.workspaceSymbols(params.query);
				if (symbols.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: `No symbols matching "${params.query}" found.`,
							},
						],
						details: {},
					};
				}

				const lines = symbols.slice(0, 50).map((sym: any) => {
					const kind =
						SYMBOL_KIND_NAMES[sym.kind] ?? `Kind(${sym.kind})`;
					const loc = sym.location;
					const filePath = loc ? uriToPath(loc.uri) : "";
					const line = loc?.range?.start?.line
						? `:${loc.range.start.line + 1}`
						: "";
					return `  ${kind} ${sym.name}  ${filePath}${line}`;
				});

				return {
					content: [
						{
							type: "text",
							text: `Found ${symbols.length} symbols:\n\n${lines.join("\n")}`,
						},
					],
					details: {},
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `LSP error: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					details: {},
				};
			}
		},
	});

	// -------------------------------------------------------------------------
	// lsp_call_hierarchy
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "lsp_call_hierarchy",
		label: "Call Hierarchy",
		description:
			'Show who calls a function (incoming) or what a function calls (outgoing). Set direction to "incoming" or "outgoing".',
		parameters: Type.Object({
			filePath: Type.String({
				description: "Absolute path to the file",
			}),
			line: Type.Number({ description: "Line number (1-based)" }),
			character: Type.Number({
				description: "Character offset (1-based)",
			}),
			direction: Type.String({
				description: '"incoming" (who calls this) or "outgoing" (what this calls)',
			}),
		}),
		async execute(
			_id: string,
			params: {
				filePath: string;
				line: number;
				character: number;
				direction: string;
			},
		) {
			try {
				const dir =
					params.direction === "outgoing" ? "outgoing" : "incoming";
				const client = await getClient(params.filePath);
				const calls = await client.callHierarchy(
					params.filePath,
					params.line - 1,
					params.character - 1,
					dir,
				);

				if (calls.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: `No ${dir} calls found.`,
							},
						],
						details: {},
					};
				}

				const lines = calls.slice(0, 30).map((call: any) => {
					const item =
						dir === "incoming" ? call.from : call.to;
					if (!item) return "  (unknown)";
					const filePath = uriToPath(item.uri);
					const line = item.range?.start?.line
						? `:${item.range.start.line + 1}`
						: "";
					return `  ${item.name}  ${filePath}${line}`;
				});

				return {
					content: [
						{
							type: "text",
							text: `${dir === "incoming" ? "Called by" : "Calls"} (${calls.length}):\n\n${lines.join("\n")}`,
						},
					],
					details: {},
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `LSP error: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					details: {},
				};
			}
		},
	});

	// -------------------------------------------------------------------------
	// Cleanup on shutdown
	// -------------------------------------------------------------------------
	pi.on("session_shutdown", () => {
		for (const [, client] of clients) {
			client.shutdown();
		}
		clients.clear();
	});
}
