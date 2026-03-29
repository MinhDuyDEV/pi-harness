/**
 * Memory system tool registrations for Pi coding agent extension.
 * Registers 7 tools: observation, memory-search, memory-get, memory-read,
 * memory-update, memory-timeline, memory-admin.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { Type } from "@sinclair/typebox";

import type {
	ConfidenceLevel,
	ObservationSource,
	ObservationType,
} from "./config.js";
import { curateFromDistillations } from "./curator.js";
import { distillSession } from "./distill.js";
import {
	autoDetectFiles,
	formatObservation,
	parseCSV,
	TYPE_ICONS,
	VALID_TYPES,
} from "./helpers.js";
import {
	archiveOldObservations,
	checkFTS5Available,
	checkpointWAL,
	getDatabaseSizes,
	getMemoryFile,
	runFullMaintenance,
	upsertMemoryFile,
	vacuumDatabase,
} from "./maintenance.js";
import {
	getObservationStats,
	getObservationsByIds,
	getTimelineAroundObservation,
	markObservationsRetrieved,
	searchObservationsFTS,
	searchObservationsHybrid,
	storeObservation,
} from "./observations.js";
import {
	getCaptureStats,
	getDistillationStats,
	searchDistillationsFTS,
} from "./pipeline.js";
import { recordFeedback, refreshAllScores } from "./scoring.js";
import { isSqliteVecAvailable } from "./db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_CONFIDENCES: ConfidenceLevel[] = ["high", "medium", "low"];

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// registerMemoryTools
// ---------------------------------------------------------------------------

// pi is the ExtensionAPI type from Pi (use `any` since we don't have the type package)
export function registerMemoryTools(pi: any): void {
	// -------------------------------------------------------------------------
	// Tool 1: observation
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "observation",
		label: "Create Observation",
		description:
			"Create a structured observation for future reference. Captures decisions, bugs, features, patterns, discoveries, learnings, or warnings with optional metadata.",
		promptGuidelines: [
			"Search memory (memory-search) before making decisions that may repeat past patterns or contradict earlier decisions.",
			"Record important decisions, discoveries, and patterns as observations so they persist across sessions.",
			"When you learn something surprising or make a non-obvious choice, create an observation to capture it.",
		],
		parameters: Type.Object({
			type: Type.String({
				description:
					'Observation type: "decision", "bugfix", "feature", "pattern", "discovery", "learning", "warning"',
			}),
			title: Type.String({ description: "Brief title for the observation" }),
			subtitle: Type.Optional(
				Type.String({ description: "Optional subtitle or context" }),
			),
			facts: Type.Optional(
				Type.String({ description: "Comma-separated key facts" }),
			),
			narrative: Type.Optional(
				Type.String({ description: "Detailed content / narrative" }),
			),
			content: Type.Optional(
				Type.String({
					description: "DEPRECATED alias for narrative",
				}),
			),
			concepts: Type.Optional(
				Type.String({ description: "Comma-separated concept tags" }),
			),
			files_read: Type.Optional(
				Type.String({ description: "Comma-separated files read" }),
			),
			files_modified: Type.Optional(
				Type.String({ description: "Comma-separated files modified" }),
			),
			files: Type.Optional(
				Type.String({
					description: "DEPRECATED alias for files_modified",
				}),
			),
			bead_id: Type.Optional(
				Type.String({ description: "Associated bead / task ID" }),
			),
			confidence: Type.Optional(
				Type.String({
					description: 'Confidence level: "high" (default), "medium", "low"',
				}),
			),
			supersedes: Type.Optional(
				Type.String({
					description: "Observation ID (numeric) this supersedes",
				}),
			),
			source: Type.Optional(
				Type.String({
					description: 'Source: "manual" (default), "curator", "imported"',
				}),
			),
		}),
		async execute(
			_toolCallId: string,
			params: {
				type: string;
				title: string;
				subtitle?: string;
				facts?: string;
				narrative?: string;
				content?: string;
				concepts?: string;
				files_read?: string;
				files_modified?: string;
				files?: string;
				bead_id?: string;
				confidence?: string;
				supersedes?: string;
				source?: string;
			},
			_signal: AbortSignal,
			_onUpdate: (text: string) => void,
			_ctx: any,
		) {
			try {
				// Validate type
				const obsType = params.type as ObservationType;
				if (!VALID_TYPES.includes(obsType)) {
					const result = `❌ Invalid type "${params.type}". Must be one of: ${VALID_TYPES.join(", ")}`;
					return { content: [{ type: "text", text: result }], details: {} };
				}

				// Validate confidence
				const rawConf = (params.confidence ?? "high") as ConfidenceLevel;
				if (!VALID_CONFIDENCES.includes(rawConf)) {
					const result = `❌ Invalid confidence "${params.confidence}". Must be one of: ${VALID_CONFIDENCES.join(", ")}`;
					return { content: [{ type: "text", text: result }], details: {} };
				}
				const confidence: ConfidenceLevel = rawConf;

				// Narrative: prefer narrative, fall back to content
				const narrative = params.narrative ?? params.content;

				// Files modified: prefer files_modified, fall back to files
				const rawFilesModified = params.files_modified ?? params.files;

				// Parse CSV fields
				const facts = parseCSV(params.facts);
				const concepts = parseCSV(params.concepts);
				const filesRead = parseCSV(params.files_read);
				const filesModified = parseCSV(rawFilesModified);

				// Auto-detect file references from narrative
				const autoFiles = narrative ? autoDetectFiles(narrative) : [];
				const allFilesModified =
					filesModified && filesModified.length > 0
						? filesModified
						: autoFiles.length > 0
							? autoFiles
							: undefined;

				// Parse supersedes
				const supersedesId = params.supersedes
					? parseInt(params.supersedes, 10)
					: undefined;
				const supersedes =
					supersedesId !== undefined && !Number.isNaN(supersedesId)
						? supersedesId
						: undefined;

				// Validate source
				const validSources: ObservationSource[] = [
					"manual",
					"curator",
					"imported",
				];
				const source: ObservationSource =
					params.source &&
					validSources.includes(params.source as ObservationSource)
						? (params.source as ObservationSource)
						: "manual";

				const id = storeObservation({
					type: obsType,
					title: params.title,
					subtitle: params.subtitle,
					facts,
					narrative,
					concepts,
					files_read: filesRead,
					files_modified: allFilesModified,
					confidence,
					bead_id: params.bead_id,
					supersedes,
					source,
				});

				const icon = TYPE_ICONS[obsType] ?? "📌";
				const result = `${icon} Observation stored as **#${id}** [${obsType}]: ${params.title}${confidence !== "high" ? ` (confidence: ${confidence})` : ""}`;
				return { content: [{ type: "text", text: result }], details: {} };
			} catch (err) {
				const result = `❌ Failed to store observation: ${err instanceof Error ? err.message : String(err)}`;
				return { content: [{ type: "text", text: result }], details: {} };
			}
		},
	});

	// -------------------------------------------------------------------------
	// Tool 2: memory-search
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "memory-search",
		label: "Memory Search",
		description:
			'Search memory across observations, distillations, and handoffs. Scope with type: "observations" (default), "distillations", "handoffs", "all", or any observation type name.',
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			type: Type.Optional(
				Type.String({
					description:
						'Filter scope: "observations" (default), "distillations", "handoffs", "all", or observation type (decision, bugfix, …)',
				}),
			),
			limit: Type.Optional(
				Type.Number({ description: "Max results per source (default 10)" }),
			),
		}),
		async execute(
			_toolCallId: string,
			params: { query: string; type?: string; limit?: number },
			_signal: AbortSignal,
			_onUpdate: (text: string) => void,
			_ctx: any,
		) {
			try {
				const query = params.query?.trim();
				if (!query) {
					return {
						content: [{ type: "text", text: "❌ query must not be empty" }],
						details: {},
					};
				}

				const scope = params.type ?? "observations";
				const limit = params.limit ?? 10;
				const sections: string[] = [];

				// -- Observations -------------------------------------------------
				const searchObs =
					scope === "observations" ||
					scope === "all" ||
					VALID_TYPES.includes(scope as ObservationType);

				if (searchObs) {
					const typeFilter = VALID_TYPES.includes(scope as ObservationType)
						? (scope as ObservationType)
						: undefined;

					// Use hybrid search (FTS5 + vector) when available
					const results = await searchObservationsHybrid(query, {
						type: typeFilter,
						limit,
					});

					if (results.length > 0) {
						// Track retrievals for search results
						markObservationsRetrieved(results.map((r) => r.id));

						const hasVector = isSqliteVecAvailable();
						const header = typeFilter
							? `### Observations [${typeFilter}]${hasVector ? " (hybrid)" : ""}`
							: `### Observations${hasVector ? " (hybrid)" : ""}`;
						const lines = results.map((r) => {
							const icon = TYPE_ICONS[r.type] ?? "📌";
							const score = r.combined_score.toFixed(3);
							const snippet = r.snippet
								? ` — ${r.snippet.replace(/\n/g, " ").slice(0, 80)}`
								: "";
							return `${icon} #${r.id} [${r.type}] ${r.title} (${score})${snippet}`;
						});
						sections.push(`${header}\n${lines.join("\n")}`);
					}
				}

				// -- Distillations ------------------------------------------------
				const searchDist = scope === "distillations" || scope === "all";

				if (searchDist) {
					const results = searchDistillationsFTS(query, limit);
					if (results.length > 0) {
						const lines = results.map((r) => {
							const score = r.relevance_score.toFixed(3);
							const snippet = r.snippet
								? ` — ${r.snippet.replace(/\n/g, " ").slice(0, 80)}`
								: "";
							return `📝 #${r.id} [session: ${r.session_id}] (${score})${snippet}`;
						});
						sections.push(`### Distillations\n${lines.join("\n")}`);
					}
				}

				// -- Handoffs -----------------------------------------------------
				const searchHandoffs = scope === "handoffs" || scope === "all";

				if (searchHandoffs) {
					const handoffDir = path.join(
						process.cwd(),
						".pi",
						"memory",
						"handoffs",
					);
					try {
						const files = (await readdir(handoffDir)).filter((f) =>
							f.endsWith(".md"),
						);
						const matches: string[] = [];
						const lowerQuery = query.toLowerCase();

						for (const file of files) {
							const content = await readFile(
								path.join(handoffDir, file),
								"utf-8",
							).catch(() => "");
							if (content.toLowerCase().includes(lowerQuery)) {
								const idx = content.toLowerCase().indexOf(lowerQuery);
								const snippetStart = Math.max(0, idx - 40);
								const snippetEnd = Math.min(
									content.length,
									idx + query.length + 80,
								);
								const snippet = content
									.slice(snippetStart, snippetEnd)
									.replace(/\n/g, " ")
									.trim();
								matches.push(
									`📂 ${file}${matches.length < limit ? ` — …${snippet}…` : ""}`,
								);
							}
							if (matches.length >= limit) break;
						}

						if (matches.length > 0) {
							sections.push(`### Handoffs\n${matches.join("\n")}`);
						}
					} catch {
						// Handoff directory doesn't exist yet — skip silently
					}
				}

				const result =
					sections.length > 0 ? sections.join("\n\n") : "No results found.";
				return { content: [{ type: "text", text: result }], details: {} };
			} catch (err) {
				const result = `❌ Search failed: ${err instanceof Error ? err.message : String(err)}`;
				return { content: [{ type: "text", text: result }], details: {} };
			}
		},
	});

	// -------------------------------------------------------------------------
	// Tool 3: memory-get
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "memory-get",
		label: "Memory Get",
		description:
			"Get full observation details by ID. Accepts comma-separated IDs for batch retrieval.",
		parameters: Type.Object({
			ids: Type.String({
				description: "Comma-separated observation IDs (e.g. '42' or '1,5,10')",
			}),
		}),
		async execute(
			_toolCallId: string,
			params: { ids: string },
			_signal: AbortSignal,
			_onUpdate: (text: string) => void,
			_ctx: any,
		) {
			try {
				const numericIds = params.ids
					.split(",")
					.map((s) => parseInt(s.trim(), 10))
					.filter((n) => !Number.isNaN(n));

				if (numericIds.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: "❌ No valid numeric IDs provided.",
							},
						],
						details: {},
					};
				}

				const observations = getObservationsByIds(numericIds);

				if (observations.length === 0) {
					const result = `No observations found for ID(s): ${params.ids}`;
					return { content: [{ type: "text", text: result }], details: {} };
				}

				const result = observations
					.map((obs) => formatObservation(obs))
					.join("\n\n---\n\n");
				return { content: [{ type: "text", text: result }], details: {} };
			} catch (err) {
				const result = `❌ Failed to retrieve observations: ${err instanceof Error ? err.message : String(err)}`;
				return { content: [{ type: "text", text: result }], details: {} };
			}
		},
	});

	// -------------------------------------------------------------------------
	// Tool 4: memory-read
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "memory-read",
		label: "Memory Read",
		description:
			"Read a memory file from SQLite storage. Specify file path without .md extension.",
		parameters: Type.Object({
			file: Type.Optional(
				Type.String({
					description:
						"Memory file path without .md extension (e.g. 'project/tech-stack' or 'handoffs/2024-01-20')",
				}),
			),
		}),
		async execute(
			_toolCallId: string,
			params: { file?: string },
			_signal: AbortSignal,
			_onUpdate: (text: string) => void,
			_ctx: any,
		) {
			try {
				if (!params.file) {
					return {
						content: [
							{
								type: "text",
								text: "❌ No file path provided. Specify a file path without .md extension.",
							},
						],
						details: {},
					};
				}

				// Strip .md suffix if present
				const filePath = params.file.replace(/\.md$/, "");

				const row = getMemoryFile(filePath);
				if (!row) {
					const result = `Memory file not found: ${filePath}`;
					return { content: [{ type: "text", text: result }], details: {} };
				}

				return {
					content: [{ type: "text", text: row.content }],
					details: {},
				};
			} catch (err) {
				const result = `❌ Failed to read memory file: ${err instanceof Error ? err.message : String(err)}`;
				return { content: [{ type: "text", text: result }], details: {} };
			}
		},
	});

	// -------------------------------------------------------------------------
	// Tool 5: memory-update
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "memory-update",
		label: "Memory Update",
		description:
			"Write or append to a memory file in SQLite storage. Use mode 'replace' (default) to overwrite or 'append' to add content.",
		parameters: Type.Object({
			file: Type.String({
				description: "Memory file path (without .md extension)",
			}),
			content: Type.String({
				description: "Content to write to the memory file",
			}),
			mode: Type.Optional(
				Type.String({
					description: '"replace" (default) to overwrite, "append" to add',
				}),
			),
		}),
		async execute(
			_toolCallId: string,
			params: { file: string; content: string; mode?: string },
			_signal: AbortSignal,
			_onUpdate: (text: string) => void,
			_ctx: any,
		) {
			try {
				// Strip .md suffix
				const filePath = params.file.replace(/\.md$/, "");

				const isAppend = params.mode === "append";
				let finalContent = params.content;

				// Prepend timestamp header for append mode
				if (isAppend) {
					const timestamp = new Date()
						.toISOString()
						.replace("T", " ")
						.slice(0, 19);
					finalContent = `\n\n---\n_Appended: ${timestamp}_\n\n${params.content}`;
				}

				upsertMemoryFile(
					filePath,
					finalContent,
					isAppend ? "append" : "replace",
				);

				const action = isAppend ? "appended to" : "wrote to";
				const result = `✅ Successfully ${action} memory file: ${filePath}`;
				return { content: [{ type: "text", text: result }], details: {} };
			} catch (err) {
				const result = `❌ Failed to update memory file: ${err instanceof Error ? err.message : String(err)}`;
				return { content: [{ type: "text", text: result }], details: {} };
			}
		},
	});

	// -------------------------------------------------------------------------
	// Tool 6: memory-timeline
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "memory-timeline",
		label: "Memory Timeline",
		description:
			"Get chronological context around an observation — shows what was recorded before and after a given observation ID.",
		parameters: Type.Object({
			anchor_id: Type.Number({
				description: "Observation ID to center the timeline around",
			}),
			depth_before: Type.Optional(
				Type.Number({
					description:
						"Number of observations to show before anchor (default 5)",
				}),
			),
			depth_after: Type.Optional(
				Type.Number({
					description:
						"Number of observations to show after anchor (default 5)",
				}),
			),
		}),
		async execute(
			_toolCallId: string,
			params: {
				anchor_id: number;
				depth_before?: number;
				depth_after?: number;
			},
			_signal: AbortSignal,
			_onUpdate: (text: string) => void,
			_ctx: any,
		) {
			try {
				const depthBefore = params.depth_before ?? 5;
				const depthAfter = params.depth_after ?? 5;

				const { anchor, before, after } = getTimelineAroundObservation(
					params.anchor_id,
					depthBefore,
					depthAfter,
				);

				if (!anchor) {
					const result = `❌ Observation #${params.anchor_id} not found.`;
					return { content: [{ type: "text", text: result }], details: {} };
				}

				const lines: string[] = [];

				// Before entries (oldest first for chronological flow)
				if (before.length > 0) {
					lines.push("### Before");
					for (const entry of [...before].reverse()) {
						const icon = TYPE_ICONS[entry.type] ?? "📌";
						const snippet = entry.snippet
							? ` — ${entry.snippet.replace(/\n/g, " ").slice(0, 60)}`
							: "";
						lines.push(
							`  ${icon} #${entry.id} [${entry.type}] ${entry.title} _(${entry.created_at})_${snippet}`,
						);
					}
				}

				// Anchor (highlighted)
				lines.push("\n### ▶ Anchor");
				lines.push(formatObservation(anchor));

				// After entries
				if (after.length > 0) {
					lines.push("\n### After");
					for (const entry of after) {
						const icon = TYPE_ICONS[entry.type] ?? "📌";
						const snippet = entry.snippet
							? ` — ${entry.snippet.replace(/\n/g, " ").slice(0, 60)}`
							: "";
						lines.push(
							`  ${icon} #${entry.id} [${entry.type}] ${entry.title} _(${entry.created_at})_${snippet}`,
						);
					}
				}

				const result = lines.join("\n");
				return { content: [{ type: "text", text: result }], details: {} };
			} catch (err) {
				const result = `❌ Failed to get timeline: ${err instanceof Error ? err.message : String(err)}`;
				return { content: [{ type: "text", text: result }], details: {} };
			}
		},
	});

	// -------------------------------------------------------------------------
	// Tool 7: memory-admin
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "memory-admin",
		label: "Memory Admin",
		description:
			'Memory system administration. Operations: "status", "full", "archive", "checkpoint", "vacuum", "capture-stats", "distill-now", "curate-now".',
		parameters: Type.Object({
			operation: Type.Optional(
				Type.String({
					description:
						'Operation to run (default "status"): "status", "full", "archive", "checkpoint", "vacuum", "capture-stats", "distill-now", "curate-now", "refresh-scores"',
				}),
			),
			older_than_days: Type.Optional(
				Type.Number({
					description:
						"Age threshold in days for archive operation (default 90)",
				}),
			),
			dry_run: Type.Optional(
				Type.Boolean({
					description: "Preview without applying changes (default false)",
				}),
			),
			force: Type.Optional(
				Type.Boolean({ description: "Force the operation even if not needed" }),
			),
		}),
		async execute(
			_toolCallId: string,
			params: {
				operation?: string;
				older_than_days?: number;
				dry_run?: boolean;
				force?: boolean;
			},
			_signal: AbortSignal,
			_onUpdate: (text: string) => void,
			ctx: any,
		) {
			const op = params.operation ?? "status";
			const olderThanDays = params.older_than_days ?? 90;
			const dryRun = params.dry_run ?? false;

			try {
				switch (op) {
					case "status": {
						const sizes = getDatabaseSizes();
						const obsStats = getObservationStats();
						const captureStats = getCaptureStats();
						const distStats = getDistillationStats();
						const fts5 = checkFTS5Available();

						const obsTotal = Object.values(obsStats).reduce(
							(sum, n) => sum + n,
							0,
						);
						const obsLines = VALID_TYPES.map((t) => {
							const count = obsStats[t] ?? 0;
							const icon = TYPE_ICONS[t] ?? "📌";
							return `  ${icon} ${t}: ${count}`;
						}).join("\n");

						const newestDate = captureStats.newestMs
							? new Date(captureStats.newestMs).toISOString().slice(0, 10)
							: "—";
						const oldestDate = captureStats.oldestMs
							? new Date(captureStats.oldestMs).toISOString().slice(0, 10)
							: "—";

						const result = [
							"## Memory System Status",
							"",
							"**Database Sizes**",
							`  Main DB : ${formatBytes(sizes.mainDb)}`,
							`  WAL     : ${formatBytes(sizes.wal)}`,
							`  SHM     : ${formatBytes(sizes.shm)}`,
							`  Total   : ${formatBytes(sizes.total)}`,
							"",
							`**FTS5 Available:** ${fts5 ? "✅ yes" : "❌ no"}`,
							`**Vector Search (sqlite-vec):** ${isSqliteVecAvailable() ? "✅ yes (hybrid mode)" : "❌ no (FTS5-only mode)"}`,
							"",
							`**Observations** (${obsTotal} active)`,
							obsLines,
							"",
							"**Capture (Temporal Messages)**",
							`  Total     : ${captureStats.total}`,
							`  Undistilled: ${captureStats.undistilled}`,
							`  Sessions  : ${captureStats.sessions}`,
							`  Oldest    : ${oldestDate}`,
							`  Newest    : ${newestDate}`,
							"",
							"**Distillations**",
							`  Total    : ${distStats.total}`,
							`  Sessions : ${distStats.sessions}`,
							`  Avg compression: ${distStats.avgCompression !== null ? distStats.avgCompression.toFixed(3) : "—"}`,
							`  Messages covered: ${distStats.totalMessages}`,
						].join("\n");

						return { content: [{ type: "text", text: result }], details: {} };
					}

					case "full": {
						const stats = runFullMaintenance({
							olderThanDays,
							dryRun,
						});
						const result = [
							"## Full Maintenance Complete",
							`  Archived observations : ${stats.archived}`,
							`  Purged messages       : ${stats.purgedMessages}`,
							`  Pruned markdown files : ${stats.prunedMarkdown}`,
							`  WAL checkpointed      : ${stats.checkpointed ? "yes" : "no"}`,
							`  Vacuumed              : ${stats.vacuumed ? "yes" : "no"}`,
							`  DB size before        : ${formatBytes(stats.dbSizeBefore)}`,
							`  DB size after         : ${formatBytes(stats.dbSizeAfter)}`,
							`  Freed                 : ${formatBytes(stats.freedBytes)}`,
						].join("\n");
						return { content: [{ type: "text", text: result }], details: {} };
					}

					case "archive": {
						const archived = archiveOldObservations({
							olderThanDays,
							dryRun,
						});
						const dryMsg = dryRun ? " (dry run)" : "";
						const result = `🗄️ Archived ${archived} observation(s) older than ${olderThanDays} days${dryMsg}.`;
						return { content: [{ type: "text", text: result }], details: {} };
					}

					case "checkpoint": {
						const wal = checkpointWAL();
						const result = `🔄 WAL checkpoint ${wal.checkpointed ? "succeeded" : "not needed"}. WAL size: ${formatBytes(wal.walSize)}`;
						return { content: [{ type: "text", text: result }], details: {} };
					}

					case "vacuum": {
						const ok = vacuumDatabase();
						const result = ok
							? "🧹 Database vacuumed successfully."
							: "⚠️ Vacuum did not complete.";
						return { content: [{ type: "text", text: result }], details: {} };
					}

					case "capture-stats": {
						const stats = getCaptureStats();
						const result = JSON.stringify(stats, null, 2);
						return { content: [{ type: "text", text: result }], details: {} };
					}

					case "distill-now": {
						const sessionId = "default";
						const distillationId = distillSession(sessionId);
						const result =
							distillationId !== null
								? `✅ Distillation complete. New distillation ID: ${distillationId} (session: ${sessionId})`
								: `ℹ️ Distillation skipped — not enough messages or distillation disabled (session: ${sessionId})`;
						return { content: [{ type: "text", text: result }], details: {} };
					}

					case "curate-now": {
						const curatorResult = curateFromDistillations();
						const result = [
							`🧠 Curation complete.`,
							`  Observations created : ${curatorResult.created}`,
							`  Candidates skipped   : ${curatorResult.skipped}`,
						].join("\n");
						return { content: [{ type: "text", text: result }], details: {} };
					}

					case "refresh-scores": {
						const scoreResult = refreshAllScores();
						const result = [
							`📊 Score refresh complete.`,
							`  Updated    : ${scoreResult.updated} observations`,
							`  Deprecated : ${scoreResult.deprecated} observations`,
						].join("\n");
						return { content: [{ type: "text", text: result }], details: {} };
					}

					default: {
						const validOps = [
							"status",
							"full",
							"archive",
							"checkpoint",
							"vacuum",
							"capture-stats",
							"distill-now",
							"curate-now",
							"refresh-scores",
						];
						const result = `❌ Unknown operation "${op}". Must be one of: ${validOps.join(", ")}`;
						return { content: [{ type: "text", text: result }], details: {} };
					}
				}
			} catch (err) {
				const result = `❌ Admin operation "${op}" failed: ${err instanceof Error ? err.message : String(err)}`;
				return { content: [{ type: "text", text: result }], details: {} };
			}
		},
	});

	// -------------------------------------------------------------------------
	// Tool 8: memory-feedback
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "memory-feedback",
		label: "Memory Feedback",
		description:
			"Mark an observation as helpful or harmful. Updates time-decay scoring and maturity state. Use after applying an observation to record whether it was useful.",
		parameters: Type.Object({
			id: Type.Number({
				description: "Observation ID to give feedback on",
			}),
			feedback: Type.String({
				description: '"helpful" or "harmful"',
			}),
			reason: Type.Optional(
				Type.String({
					description: "Brief reason for the feedback",
				}),
			),
		}),
		async execute(
			_toolCallId: string,
			params: { id: number; feedback: string; reason?: string },
			_signal: AbortSignal,
			_onUpdate: (text: string) => void,
			_ctx: any,
		) {
			try {
				const feedbackType = params.feedback as "helpful" | "harmful";
				if (feedbackType !== "helpful" && feedbackType !== "harmful") {
					return {
						content: [
							{
								type: "text",
								text: `❌ Invalid feedback type "${params.feedback}". Must be "helpful" or "harmful".`,
							},
						],
						details: {},
					};
				}

				const result = recordFeedback(
					params.id,
					feedbackType,
					params.reason,
				);

				if (!result.success) {
					return {
						content: [
							{ type: "text", text: `❌ ${result.error}` },
						],
						details: {},
					};
				}

				const icon = feedbackType === "helpful" ? "👍" : "👎";
				const maturityIcon =
					result.maturity === "proven"
						? "🏆"
						: result.maturity === "established"
							? "✅"
							: result.maturity === "deprecated"
								? "🚫"
								: "🔄";

				const text = [
					`${icon} Feedback recorded for observation #${params.id}`,
					`  Score: ${result.effectiveScore.toFixed(2)} (${result.helpfulCount}👍 / ${result.harmfulCount}👎)`,
					`  ${maturityIcon} Maturity: ${result.maturity}`,
					params.reason ? `  Reason: ${params.reason}` : "",
				]
					.filter(Boolean)
					.join("\n");

				return { content: [{ type: "text", text }], details: {} };
			} catch (err) {
				const result = `❌ Feedback failed: ${err instanceof Error ? err.message : String(err)}`;
				return { content: [{ type: "text", text: result }], details: {} };
			}
		},
	});
}
