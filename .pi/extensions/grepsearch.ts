/**
 * GitHub Code Search Extension (grep.app)
 *
 * Search real-world code examples from GitHub repositories.
 * Useful for finding production patterns, API usage examples,
 * and understanding how libraries are used in practice.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const GREP_APP_API = "https://grep.app/api/search";

interface SearchResult {
	repo: string;
	path: string;
	content: { snippet: string };
	total_matches: string;
}

interface GrepResponse {
	hits: { hits: SearchResult[] };
	time: number;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "grepsearch",
		label: "Grep Search",
		description: `Search real-world code examples from GitHub repositories via grep.app.

Use when:
- Implementing unfamiliar APIs - see how others use a library
- Looking for production patterns - find real-world examples
- Understanding library integrations - see how things work together

IMPORTANT: Search for **literal code patterns**, not keywords:
Good: "useState(", "import React from", "async function"
Bad: "react tutorial", "best practices", "how to use"

Examples:
  grepsearch({ query: "getServerSession", language: "TypeScript" })
  grepsearch({ query: "CORS(", language: "Python", repo: "flask" })
  grepsearch({ query: "export async function POST", path: "route.ts" })`,
		promptSnippet:
			"Search real-world code examples from GitHub repos via grep.app.",

		parameters: Type.Object({
			query: Type.String({
				description: "Code pattern to search for (literal text)",
			}),
			language: Type.Optional(
				Type.String({
					description:
						"Filter by language: TypeScript, TSX, Python, Go, Rust, etc.",
				}),
			),
			repo: Type.Optional(
				Type.String({
					description: "Filter by repo: 'owner/repo' or partial match",
				}),
			),
			path: Type.Optional(
				Type.String({
					description: "Filter by file path: 'src/', '.test.ts', etc.",
				}),
			),
			limit: Type.Optional(
				Type.Number({
					description: "Max results to return (default: 10, max: 20)",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { query, language, repo, path, limit = 10 } = params;

			if (!query || query.trim() === "") {
				return {
					content: [
						{ type: "text" as const, text: "Error: query is required" },
					],
					details: { error: "query required" },
				};
			}

			// Build URL with proper filter parameters
			const url = new URL(GREP_APP_API);
			url.searchParams.set("q", query);

			if (language) {
				url.searchParams.set("filter[lang][0]", language);
			}
			if (repo) {
				url.searchParams.set("filter[repo][0]", repo);
			}
			if (path) {
				url.searchParams.set("filter[path][0]", path);
			}

			try {
				const response = await fetch(url.toString(), {
					headers: {
						Accept: "application/json",
						"User-Agent": "Pi/1.0",
					},
				});

				if (!response.ok) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Error: grep.app API returned ${response.status}`,
							},
						],
						details: { error: `http_${response.status}` },
					};
				}

				const data = (await response.json()) as GrepResponse;

				if (!data.hits?.hits?.length) {
					return {
						content: [
							{
								type: "text" as const,
								text: `No results found for: ${query}${language ? ` (${language})` : ""}`,
							},
						],
						details: { query, results: 0 },
					};
				}

				const maxResults = Math.min(limit, 20);
				const results = data.hits.hits.slice(0, maxResults);

				const formatted = results.map((hit, i) => {
					const repoName = hit.repo || "unknown";
					const filePath = hit.path || "unknown";
					const snippet = hit.content?.snippet || "";

					// Clean up HTML from snippet
					const cleanCode = snippet
						.replace(/<[^>]*>/g, "")
						.replace(/&lt;/g, "<")
						.replace(/&gt;/g, ">")
						.replace(/&amp;/g, "&")
						.replace(/&quot;/g, '"')
						.split("\n")
						.slice(0, 8)
						.join("\n")
						.trim();

					return `## ${i + 1}. ${repoName}\n**File**: ${filePath}\n\`\`\`\n${cleanCode}\n\`\`\``;
				});

				return {
					content: [
						{
							type: "text" as const,
							text: `Found ${data.hits.hits.length} results (showing ${results.length}) in ${data.time}ms:\n\n${formatted.join("\n\n")}`,
						},
					],
					details: {
						query,
						language,
						totalResults: data.hits.hits.length,
						shown: results.length,
						timeMs: data.time,
					},
				};
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: "text" as const,
							text: `Error searching grep.app: ${message}`,
						},
					],
					details: { error: message },
				};
			}
		},
	});
}
