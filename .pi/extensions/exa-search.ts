/**
 * Exa AI Search Extension — Web + Code search via Exa's free MCP endpoint.
 * No API key required. Ported from OpenCode's websearch/codesearch tools.
 *
 * Tools:
 *   - websearch: Real-time web search with optional live crawling
 *   - codesearch: Code-specific search optimized for programming docs/examples
 */

import { Type } from "@sinclair/typebox";

export default function exaSearchExtension(pi: any): void {
	const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
	const USER_AGENT = "pi-coding-agent/1.0";

	// ---------------------------------------------------------------------------
	// Shared: call Exa MCP endpoint via JSON-RPC 2.0 over SSE
	// ---------------------------------------------------------------------------

	async function callExaMCP(
		toolName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
		timeoutMs = 30_000,
	): Promise<string> {
		const controller = new AbortController();
		const combinedSignal = signal
			? AbortSignal.any([signal, controller.signal])
			: controller.signal;

		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const body = JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: toolName, arguments: args },
			});

			const response = await fetch(EXA_MCP_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
					"User-Agent": USER_AGENT,
				},
				body,
				signal: combinedSignal,
			});

			if (!response.ok) {
				throw new Error(
					`Exa MCP returned ${response.status}: ${response.statusText}`,
				);
			}

			// Parse response — may be JSON directly or SSE stream
			const text = await response.text();
			const contentType = response.headers.get("content-type") ?? "";

			// Try direct JSON first
			if (contentType.includes("application/json") || text.startsWith("{")) {
				try {
					const parsed = JSON.parse(text);
					if (parsed.result?.content) {
						return parsed.result.content
							.filter((c: any) => c.type === "text")
							.map((c: any) => c.text)
							.join("\n");
					}
					if (parsed.error) {
						throw new Error(
							`Exa error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`,
						);
					}
				} catch (e) {
					if (!(e instanceof SyntaxError)) throw e;
				}
			}

			// Fall back to SSE parsing
			const dataLines = text
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trim());

			for (const line of dataLines) {
				try {
					const parsed = JSON.parse(line);
					if (parsed.result?.content) {
						return parsed.result.content
							.filter((c: any) => c.type === "text")
							.map((c: any) => c.text)
							.join("\n");
					}
					if (parsed.error) {
						throw new Error(
							`Exa error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`,
						);
					}
				} catch (e) {
					if (e instanceof SyntaxError) continue;
					throw e;
				}
			}

			// Fallback: return raw text
			return dataLines.join("\n") || text.slice(0, 5000);
		} finally {
			clearTimeout(timer);
		}
	}

	// ---------------------------------------------------------------------------
	// Tool 1: websearch — Real-time web search
	// ---------------------------------------------------------------------------

	pi.registerTool({
		name: "websearch",
		label: "Web Search",
		description:
			"Search the web using Exa AI. Returns relevant results with content snippets. Use for current information, documentation, blog posts, discussions. No API key required.",
		parameters: Type.Object({
			query: Type.String({
				description: "Search query (be specific for better results)",
			}),
			numResults: Type.Optional(
				Type.Number({
					description: "Number of results (default 8, max 20)",
				}),
			),
			type: Type.Optional(
				Type.String({
					description:
						'"auto" (default), "neural" (semantic), or "keyword" (exact match)',
				}),
			),
		}),
		async execute(
			_toolCallId: string,
			params: { query: string; numResults?: number; type?: string },
			signal: AbortSignal,
		) {
			try {
				const result = await callExaMCP(
					"web_search_exa",
					{
						query: params.query,
						numResults: Math.min(params.numResults ?? 8, 20),
						type: params.type ?? "auto",
						livecrawl: "fallback",
						textContentsOptions: { maxCharacters: 3000 },
					},
					signal,
					25_000,
				);

				return {
					content: [{ type: "text", text: result }],
					details: {},
				};
			} catch (err) {
				const msg =
					err instanceof Error ? err.message : String(err);
				return {
					content: [
						{ type: "text", text: `Web search failed: ${msg}` },
					],
					details: {},
				};
			}
		},
	});

	// ---------------------------------------------------------------------------
	// Tool 2: codesearch — Code-specific search
	// ---------------------------------------------------------------------------

	pi.registerTool({
		name: "codesearch",
		label: "Code Search",
		description:
			"Search for programming documentation, code examples, and API references using Exa AI's code-specific index. Better than web search for technical queries. No API key required.",
		parameters: Type.Object({
			query: Type.String({
				description:
					'Code/API query (e.g. "React useState hook examples", "Go context.WithCancel usage")',
			}),
			numResults: Type.Optional(
				Type.Number({
					description: "Number of results (default 5, max 10)",
				}),
			),
		}),
		async execute(
			_toolCallId: string,
			params: { query: string; numResults?: number },
			signal: AbortSignal,
		) {
			try {
				const result = await callExaMCP(
					"get_code_context_exa",
					{
						query: params.query,
						numResults: Math.min(params.numResults ?? 5, 10),
					},
					signal,
					30_000,
				);

				return {
					content: [{ type: "text", text: result }],
					details: {},
				};
			} catch (err) {
				const msg =
					err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text",
							text: `Code search failed: ${msg}`,
						},
					],
					details: {},
				};
			}
		},
	});
}
