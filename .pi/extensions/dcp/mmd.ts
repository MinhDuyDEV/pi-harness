/**
 * DCP Mermaid Canvas Generator — Symbolic Memory for Compaction
 *
 * Converts DCP compression blocks and extracted facts into a high-density
 * Mermaid graph that serves as a lightweight task map in agent context.
 *
 * Design principles (from TencentDB-Agent-Memory):
 *   - Mermaid syntax is 5-10x denser than equivalent prose
 *   - node_id references map back to detailed evidence (compression blocks)
 *   - Agents can reason over the graph, not just read it
 *   - Humans can read it too (white-box debuggability)
 *
 * Graph layout:
 *   graph LR (left-to-right, reads like a timeline)
 *   Blocks → directed edges for progression
 *   Facts → dotted edges as annotations
 *   Files → leaf nodes
 */

import { getActiveBlocks, getFactsBySession } from "./db.js";
import type { DCPConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MermaidCanvas {
	graph: string;
	tokenEstimate: number;
	nodeCount: number;
	edgeCount: number;
}

// ---------------------------------------------------------------------------
// Mermaid Graph Generation
// ---------------------------------------------------------------------------

const MERMAID_STYLE_BLOCK = "fill:#eff6ff,stroke:#3b82f6,color:#1e3a8a";
const MERMAID_STYLE_FACT = "fill:#fef3c7,stroke:#f59e0b,color:#92400e";
const MERMAID_STYLE_FILE = "fill:#f0fdf4,stroke:#22c55e,color:#166534";
const MERMAID_STYLE_CURRENT = "fill:#fffbeb,stroke:#f97316,color:#9a3412";

/**
 * Generate a Mermaid graph canvas from DCP state for a session.
 * The graph represents compression blocks as timeline nodes,
 * extracted facts as annotations, and key decisions as edges.
 */
export function generateMermaidCanvas(
	sessionId: string,
	config: DCPConfig,
): MermaidCanvas | null {
	try {
		const blocks = getActiveBlocks(sessionId);
		if (blocks.length === 0) return null;

		const facts = getFactsBySession(sessionId);
		const nodeIds = new Set<string>();
		const edges: string[] = [];
		const nodes: string[] = [];
		const subgraphs: string[] = [];

		// --- Compression blocks as primary timeline nodes ---
		let prevBlockId: string | null = null;

		for (let i = 0; i < blocks.length; i++) {
			const b = blocks[i];
			const nodeId = `B${b.block_id}`;
			const shortSummary = truncateForMermaid(b.topic, 40);
			const label = `${shortSummary}`;

			nodes.push(`    ${nodeId}["${label}"]:::block`);

			// Edge from previous block
			if (prevBlockId) {
				edges.push(`    ${prevBlockId} -->|"→"| ${nodeId}`);
			}
			prevBlockId = nodeId;
			nodeIds.add(nodeId);
		}

		// --- Facts as annotation nodes (dotted edges to their blocks) ---
		if (facts.length > 0 && config.factExtraction.enabled) {
			// Only use a sample of facts (most recent, max 8)
			const sampleFacts = facts.slice(-8);
			for (let i = 0; i < sampleFacts.length; i++) {
				const fact = sampleFacts[i];
				const nodeId = `F${i + 1}`;

				const catIcon = getCategoryIcon(fact.category);
				const shortContent = truncateForMermaid(
					`${catIcon} ${fact.content}`,
					50,
				);
				nodes.push(`    ${nodeId}["${shortContent}"]:::fact`);

				// Connect to the most relevant block (or latest if index-based)
				const targetBlock =
					i < blocks.length ? `B${blocks[i].block_id}` : prevBlockId ?? `B${blocks[blocks.length - 1].block_id}`;
				if (targetBlock) {
					edges.push(`    ${targetBlock} -.-> ${nodeId}`);
				}
				nodeIds.add(nodeId);
			}
		}

		// --- Assemble graph ---
		const graphParts: string[] = [
			"```mermaid",
			"graph LR",
			...nodes,
			"",
			...edges,
			"",
			"%% Styles",
			`    classDef block ${MERMAID_STYLE_BLOCK}`,
			`    classDef fact ${MERMAID_STYLE_FACT}`,
			`    classDef file ${MERMAID_STYLE_FILE}`,
			`    classDef current ${MERMAID_STYLE_CURRENT}`,
			"",
			"%% Apply styles",
			...blocks.map((b) => `    class B${b.block_id} block`),
			...facts.slice(-8).map((_, i) => `    class F${i + 1} fact`),
			"```",
		];

		const graph = graphParts.join("\n");
		const tokenEstimate = Math.ceil(graph.length / 4);

		return {
			graph,
			tokenEstimate,
			nodeCount: nodeIds.size,
			edgeCount: edges.length,
		};
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Mermaid-Prefixed Summary
// ---------------------------------------------------------------------------

/**
 * Generate a Mermaid canvas and prepend it to a prose compaction summary.
 * This gives agents a dense overview before the detailed text.
 *
 * Returns the original summary with a Mermaid prefix if canvas was generated,
 * or the original summary unchanged if canvas generation fails.
 */
export function mermaidPrefixSummary(
	sessionId: string,
	summary: string,
	config: DCPConfig,
): string {
	try {
		const canvas = generateMermaidCanvas(sessionId, config);
		if (!canvas) return summary;

		const header = [
			"",
			"<!-- mermaid-canvas:start -->",
			canvas.graph,
			"<!-- mermaid-canvas:end -->",
			"",
		].join("\n");

		// Prepend canvas (token-light overview) before the prose summary
		return header + summary;
	} catch {
		return summary;
	}
}

/**
 * Regenerate and store a Mermaid canvas for the current session state.
 * Returns the canvas metadata or null on failure.
 */
export function refreshMermaidCanvas(
	sessionId: string,
	config: DCPConfig,
): MermaidCanvas | null {
	return generateMermaidCanvas(sessionId, config);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Truncate text for Mermaid node labels (which can't have line breaks in graph LR).
 * Mermaid labels support HTML-style <br/> but in graph LR they're cleaner as single lines.
 */
function truncateForMermaid(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen - 3) + "...";
}

/**
 * Get an icon/emoji for a fact category.
 */
function getCategoryIcon(category: string): string {
	switch (category) {
		case "ARCHITECTURE_DECISIONS":
			return "🏗️";
		case "CONSTRAINTS":
			return "🔒";
		case "NAMING_CONVENTIONS":
			return "🏷️";
		case "KNOWN_ISSUES":
			return "🐛";
		case "WORKFLOW_RULES":
			return "📋";
		case "DEPENDENCIES":
			return "📦";
		case "FILE_PATTERNS":
			return "📁";
		case "API_CONTRACTS":
			return "🔌";
		default:
			return "📌";
	}
}
