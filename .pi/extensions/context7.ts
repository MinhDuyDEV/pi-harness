/**
 * Context7 Documentation Lookup Extension
 *
 * Provides library documentation lookup via Context7 API v2.
 * Two operations:
 * - resolve: Find library ID from name
 * - query: Get documentation for a specific topic
 *
 * Set CONTEXT7_API_KEY env var for higher rate limits (free at context7.com/dashboard).
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const CONTEXT7_API = "https://context7.com/api/v2";

interface LibraryInfo {
	id: string;
	title: string;
	description?: string;
	totalSnippets?: number;
	trustScore?: number;
	benchmarkScore?: number;
	versions?: string[];
}

interface SearchResponse {
	results: LibraryInfo[];
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "context7",
		label: "Context7",
		description: `Context7 documentation lookup: resolve library IDs and query docs.

Operations:
- "resolve": Find library ID from name (e.g., "react" → "/reactjs/react.dev")
- "query": Get documentation for a library topic

Example:
context7({ operation: "resolve", libraryName: "react" })
context7({ operation: "query", libraryId: "/reactjs/react.dev", topic: "hooks" })`,
		promptSnippet:
			"Library documentation lookup — resolve library IDs and query docs.",

		parameters: Type.Object({
			operation: Type.Optional(
				StringEnum(["resolve", "query"] as const, {
					description: 'Operation to perform (default: "resolve")',
				}),
			),
			libraryName: Type.Optional(
				Type.String({
					description: "Library name to resolve (for resolve operation)",
				}),
			),
			libraryId: Type.Optional(
				Type.String({
					description: "Library ID from resolve (for query operation)",
				}),
			),
			topic: Type.Optional(
				Type.String({
					description: "Documentation topic (for query operation)",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const operation = params.operation || "resolve";

			const apiKey = process.env.CONTEXT7_API_KEY;
			const headers: Record<string, string> = {
				Accept: "application/json",
				"User-Agent": "Pi/1.0",
			};

			if (apiKey) {
				headers.Authorization = `Bearer ${apiKey}`;
			}

			// ===== RESOLVE =====
			if (operation === "resolve") {
				const { libraryName } = params;

				if (!libraryName || libraryName.trim() === "") {
					return {
						content: [
							{
								type: "text" as const,
								text: "Error: libraryName is required for resolve operation",
							},
						],
						details: { operation: "resolve", error: "libraryName required" },
					};
				}

				try {
					const url = new URL(`${CONTEXT7_API}/libs/search`);
					url.searchParams.set("libraryName", libraryName);
					url.searchParams.set("query", "documentation");

					const response = await fetch(url.toString(), { headers });

					if (!response.ok) {
						if (response.status === 401) {
							return {
								content: [
									{
										type: "text" as const,
										text: "Error: Invalid CONTEXT7_API_KEY. Get a free key at https://context7.com/dashboard",
									},
								],
								details: { operation: "resolve", error: "auth" },
							};
						}
						if (response.status === 429) {
							return {
								content: [
									{
										type: "text" as const,
										text: "Error: Rate limit exceeded. Get a free API key at https://context7.com/dashboard for higher limits.",
									},
								],
								details: { operation: "resolve", error: "rate_limit" },
							};
						}
						return {
							content: [
								{
									type: "text" as const,
									text: `Error: Context7 API returned ${response.status}`,
								},
							],
							details: {
								operation: "resolve",
								error: `http_${response.status}`,
							},
						};
					}

					const data = (await response.json()) as SearchResponse;
					const libraries = data.results || [];

					if (!libraries || libraries.length === 0) {
						return {
							content: [
								{
									type: "text" as const,
									text: `No libraries found matching: ${libraryName}\n\nTry:\n- Different library name\n- Check spelling\n- Use official package name`,
								},
							],
							details: { operation: "resolve", query: libraryName, results: 0 },
						};
					}

					const formatted = libraries
						.slice(0, 5)
						.map((lib, i) => {
							const desc = lib.description
								? `\n   ${lib.description.slice(0, 100)}...`
								: "";
							const snippets = lib.totalSnippets
								? ` (${lib.totalSnippets} snippets)`
								: "";
							const score = lib.benchmarkScore
								? ` [score: ${lib.benchmarkScore}]`
								: "";
							return `${i + 1}. **${lib.title}** → \`${lib.id}\`${snippets}${score}${desc}`;
						})
						.join("\n\n");

					return {
						content: [
							{
								type: "text" as const,
								text: `Found ${libraries.length} libraries matching "${libraryName}":\n\n${formatted}\n\n**Next step**: Use \`context7({ operation: "query", libraryId: "${libraries[0].id}", topic: "your topic" })\` to fetch documentation.`,
							},
						],
						details: {
							operation: "resolve",
							query: libraryName,
							results: libraries.length,
							topResult: libraries[0].id,
						},
					};
				} catch (error: unknown) {
					const message =
						error instanceof Error ? error.message : String(error);
					return {
						content: [
							{
								type: "text" as const,
								text: `Error resolving library: ${message}`,
							},
						],
						details: { operation: "resolve", error: message },
					};
				}
			}

			// ===== QUERY =====
			if (operation === "query") {
				const { libraryId, topic } = params;

				if (!libraryId || libraryId.trim() === "") {
					return {
						content: [
							{
								type: "text" as const,
								text: 'Error: libraryId is required (use operation: "resolve" first)',
							},
						],
						details: { operation: "query", error: "libraryId required" },
					};
				}

				if (!topic || topic.trim() === "") {
					return {
						content: [
							{
								type: "text" as const,
								text: "Error: topic is required (e.g., 'hooks', 'setup', 'API reference')",
							},
						],
						details: { operation: "query", error: "topic required" },
					};
				}

				try {
					const url = new URL(`${CONTEXT7_API}/context`);
					url.searchParams.set("libraryId", libraryId);
					url.searchParams.set("query", topic);

					const queryHeaders = { ...headers, Accept: "text/plain" };
					const response = await fetch(url.toString(), {
						headers: queryHeaders,
					});

					if (!response.ok) {
						if (response.status === 401) {
							return {
								content: [
									{
										type: "text" as const,
										text: "Error: Invalid CONTEXT7_API_KEY. Get a free key at https://context7.com/dashboard",
									},
								],
								details: { operation: "query", error: "auth" },
							};
						}
						if (response.status === 404) {
							return {
								content: [
									{
										type: "text" as const,
										text: `Error: Library not found: ${libraryId}\n\nUse operation: "resolve" first to find the correct ID.`,
									},
								],
								details: { operation: "query", error: "not_found" },
							};
						}
						if (response.status === 429) {
							return {
								content: [
									{
										type: "text" as const,
										text: "Error: Rate limit exceeded. Get a free API key at https://context7.com/dashboard for higher limits.",
									},
								],
								details: { operation: "query", error: "rate_limit" },
							};
						}
						return {
							content: [
								{
									type: "text" as const,
									text: `Error: Context7 API returned ${response.status}`,
								},
							],
							details: { operation: "query", error: `http_${response.status}` },
						};
					}

					const content = await response.text();

					if (!content || content.trim() === "") {
						return {
							content: [
								{
									type: "text" as const,
									text: `No documentation found for "${topic}" in ${libraryId}.\n\nTry:\n- Simpler terms (e.g., "useState" instead of "state management")\n- Different topic spelling\n- Broader topics like "API reference" or "getting started"`,
								},
							],
							details: { operation: "query", libraryId, topic, results: 0 },
						};
					}

					// Truncate large responses (50KB limit)
					const maxLen = 50000;
					const truncated =
						content.length > maxLen
							? content.slice(0, maxLen) + "\n\n... (truncated)"
							: content;

					return {
						content: [
							{
								type: "text" as const,
								text: `# Documentation: ${topic} (${libraryId})\n\n${truncated}`,
							},
						],
						details: {
							operation: "query",
							libraryId,
							topic,
							length: content.length,
						},
					};
				} catch (error: unknown) {
					const message =
						error instanceof Error ? error.message : String(error);
					return {
						content: [
							{
								type: "text" as const,
								text: `Error querying documentation: ${message}`,
							},
						],
						details: { operation: "query", error: message },
					};
				}
			}

			return {
				content: [
					{
						type: "text" as const,
						text: `Unknown operation: ${operation}. Use: resolve, query`,
					},
				],
				details: { error: `unknown operation: ${operation}` },
			};
		},
	});
}
