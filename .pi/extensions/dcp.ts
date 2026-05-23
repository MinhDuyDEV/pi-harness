/**
 * DCP Extension v2 — Entry Point
 *
 * Dynamic Context Pruning extension for Pi coding agents.
 * Built on Pi's native extension API for maximum integration.
 *
 * WHAT THIS EXTENSION DOES:
 *   Phase 1 — Runtime-enforced context management:
 *     - `context` event: Auto-prunes duplicates and old errors
 *     - `turn_end` event: Real nudge system with ctx.getContextUsage()
 *     - `session_before_compact`: Enriched compaction with DCP block summaries
 *     - `before_agent_start`: Injects nudge messages and facts summary
 *     - Pi's native auto-compaction handles threshold-based compaction (we don't duplicate it)
 *
 *   Phase 2 — Magic Context-inspired features:
 *     - Monotonic message tagging for precise references
 *     - Deferred drop queue with cache TTL awareness
 *     - Fact extraction from compaction summaries
 *     - Raw transcript storage for reversible compression (ctx_expand)
 *     - ctx_expand tool for decompressing historical ranges
 *
 *   Phase 3 — Background capabilities:
 *     - Historian model config (opt-in, future)
 *
 *   Preserved from v1:
 *     - `compress` tool for manual crystallization
 *     - `/dcp` command for status overview
 *     - SQLite persistence (~/.config/pi/dcp/dcp.db)
 *     - Tool call tracking for dedup analysis
 *
 * IMPORTANT: DCP does NOT call ctx.compact() — Pi's native auto-compaction
 * already handles threshold-based compaction via _checkCompaction().
 * Calling compact() from event handlers races with the agent loop and crashes.
 * DCP only provides nudge messages to guide the agent to compress proactively.
 *
 * DEPENDENCIES:
 *   node:sqlite (built into Node.js v22.5+, no native compilation)
 *   @sinclair/typebox (bundled by Pi runtime)
 *   @mariozechner/pi-coding-agent (bundled by Pi runtime — types only)
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionCommandContext,
	ToolResultEvent,
	SessionCompactEvent,
	TurnEndEvent,
	BeforeAgentStartEvent,
	SessionBeforeCompactEvent,
	SessionBeforeTreeEvent,
	ContextEvent,
} from "@mariozechner/pi-coding-agent";

// These result types are defined in pi-coding-agent's internal extensions/types.d.ts
// but not re-exported from the main package index. Define structurally here.
interface BeforeAgentStartEventResult {
	message?: {
		customType: string;
		content: string;
		display: boolean;
		details?: unknown;
	};
	systemPrompt?: string;
}

interface SessionBeforeCompactResult {
	cancel?: boolean;
	compaction?: unknown;
}

interface SessionBeforeTreeResult {
	cancel?: boolean;
	summary?: { summary: string; details?: unknown };
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
}

import { DEFAULT_CONFIG, type DCPConfig } from "./dcp/config.js";
import { getSessionId } from "./dcp/context.js";
import {
	closeDCPDB,
	getDCPDB,
	recordToolCall,
	resetSessionState,
	getGlobalStats,
	getActiveBlocks,
	getSummaryTokens,
	getSessionStats,
	updateSessionStats,
	storeRawTranscript,
} from "./dcp/db.js";
import { registerCompressTool, registerResolveRefTool } from "./dcp/tools.js";
import { registerSnapshotTool } from "./dcp/snapshot.js";
import { applyStrategies, computePriorityMap, type StrategyResult, type CompressedRange } from "./dcp/strategies.js";
import { offloadLargeToolResults } from "./dcp/offload.js";
import { NudgeManager } from "./dcp/nudge.js";
import {
	extractFacts,
	getFactsSummary,
	expandCompressedBlock,
	generateDCPEnrichedCompaction,
} from "./dcp/compaction.js";
import { hashParams } from "./dcp/utils.js";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

function estimateToolTokens(event: ToolResultEvent): number {
	let total = 0;
	const input = event.input;
	if (input) {
		const inputStr = JSON.stringify(input);
		total += Math.ceil(inputStr.length / 4);
	}
	for (const part of event.content) {
		if (part.type === "text") {
			total += Math.ceil(part.text.length / 4);
		}
	}
	return total;
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function dcpExtension(pi: ExtensionAPI): void {
	const config: DCPConfig = { ...DEFAULT_CONFIG };

	if (!config.enabled) {
		return;
	}

	// 1. Initialize database
	try {
		getDCPDB();
	} catch (err) {
		console.error("[dcp] Failed to initialize database:", err);
		return;
	}

	// 2. Per-session state (lazily initialized on first event with ctx)
	let nudgeManager: NudgeManager = new NudgeManager(config);
	let currentTurn = 0;
	let lastStrategyResult: StrategyResult | null = null;
	let initialized = false;
	const storedBlockIds = new Set<number>(); // Track which block raw transcripts we've stored

	// Cache protected tools set (P3 fix: avoid rebuilding per event)
	const protectedToolCache = new Set([
		...config.compress.protectedTools,
		...config.strategies.deduplication.protectedTools,
	]);

	function ensureInitialized(ctx: ExtensionContext): void {
		if (initialized) return;
		const sessionId = getSessionId(ctx);
		initialized = true;
	}

	// 3. Register tools (compress + ctx_expand + vcc_snapshot)
	// pi-vcc owns vcc_recall; DCP stays focused on runtime pruning and DCP-specific context tools.
	// Pass getPriorityMap callback so compress tool can show priority suggestions in message mode
	registerCompressTool(pi, config, () => nudgeManager.getPriorityMap());
	registerExpandTool(pi, config);
	registerSnapshotTool(pi);
	registerResolveRefTool(pi, config);

	// -----------------------------------------------------------------------
	// EVENT: input — Track turn count + reset nudge consecutive counter
	// -----------------------------------------------------------------------

	pi.on("input", () => {
		currentTurn++;
	});

	// -----------------------------------------------------------------------
	// EVENT: tool_result — Record tool calls for dedup + assign tags
	// -----------------------------------------------------------------------

	pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
		try {
			ensureInitialized(ctx);
			const { toolName, toolCallId, input, isError } = event;
			const sessionId = getSessionId(ctx);

			if (!toolName || !toolCallId) return;

			// Check if compress was called — inform nudge manager
			if (toolName === "compress") {
				nudgeManager.recordCompressCall(currentTurn);
			}

			if (protectedToolCache.has(toolName)) return;

			const paramsHash = hashParams(input);
			const status = isError ? "error" : "completed";
			const tokenEstimate = estimateToolTokens(event);

			// Record for dedup analysis
			recordToolCall(sessionId, toolCallId, toolName, paramsHash, status, currentTurn, tokenEstimate);
		} catch {
			// Best-effort tracking
		}
	});

	// -----------------------------------------------------------------------
	// EVENT: context — Runtime auto-pruning before EVERY LLM call
	//
	// This is THE key hook. Pi passes a deep-cloned message array.
	// We apply all DCP strategies and return the pruned messages.
	// -----------------------------------------------------------------------

	pi.on("context", (event: ContextEvent, ctx: ExtensionContext) => {
		try {
			ensureInitialized(ctx);
			const sessionId = getSessionId(ctx);

			// Apply runtime strategies (dedup, purge-errors)
			// Note: strategies.ts uses structural AgentMessage types that are
			// compatible with pi-agent-core's AgentMessage at runtime (jiti skips typechecks)
			const { messages, totalResult, rawRanges } = applyStrategies(
				event.messages as any,
				sessionId,
				config,
				currentTurn,
			);

			// Store raw ranges for ctx_expand (keyed by compression block ID)
			if (config.expand.enabled && rawRanges.length > 0) {
				for (const range of rawRanges) {
					if (range.blockId > 0 && !storedBlockIds.has(range.blockId)) {
						try {
							const serialized = JSON.stringify(range.rawMessages);
							storeRawTranscript(sessionId, range.blockId, serialized, Math.ceil(serialized.length / 4));
							storedBlockIds.add(range.blockId);
						} catch { /* best-effort */ }
					}
				}
			}

			lastStrategyResult = totalResult;

			// Update stats if strategies pruned anything
			if (totalResult.prunedCount > 0) {
				const stats = getSessionStats(sessionId);
				if (stats) {
					updateSessionStats(sessionId, {
						total_auto_prunes: stats.total_auto_prunes + totalResult.prunedCount,
						total_pruned_tokens: stats.total_pruned_tokens + totalResult.prunedTokens,
					});
				}

				if (config.debug) {
					console.log(
						`[dcp] Auto-pruned ${totalResult.prunedCount} items (~${totalResult.prunedTokens} tokens):`,
						totalResult.actions,
					);
				}
			}

			// Tool output offloading (v3): replace large tool results with ref markers
			if (config.offload.enabled) {
				try {
					const offloadResult = offloadLargeToolResults(messages, sessionId, {
						minTokens: config.offload.minTokens,
						maxRefsPerSession: config.offload.maxRefsPerSession,
						protectedTools: config.offload.protectedTools,
					});
					if (offloadResult.offloadedCount > 0) {
						totalResult.prunedTokens += offloadResult.savedTokens;
						totalResult.prunedCount += offloadResult.offloadedCount;
						totalResult.actions.push(`offloaded ${offloadResult.offloadedCount} large tool results to refs/ (~${offloadResult.savedTokens} tokens)`);
						if (config.debug) {
							console.log(`[dcp] Offloaded ${offloadResult.offloadedCount} large tool results (~${offloadResult.savedTokens} tokens):`, offloadResult.refs);
						}
					}
				} catch {
					// Offloading is best-effort
				}
			}

			// Compute compression priority map on POST-PRUNING messages
			// (P2 fix: event.messages may include already-stripped content)
			try {
				const priorityMap = computePriorityMap(messages);
				nudgeManager.setPriorityMap(priorityMap);
			} catch {
				// Best-effort priority map
			}

			return { messages } as any; // Cast: our structural AgentMessage[] matches pi-agent-core's
		} catch (err) {
			if (config.debug) {
				console.error("[dcp] Error in context handler:", err);
			}
			// On error, return messages unchanged
			return undefined;
		}
	});

	// -----------------------------------------------------------------------
	// EVENT: turn_end — Nudge system (NO auto-compact — Pi handles that)
	//
	// IMPORTANT: We NEVER call ctx.compact() from event handlers.
	// Pi's native _checkCompaction() already handles auto-compaction at
	// threshold. Calling compact() from turn_end races with the agent loop
	// (compact() calls abort() + disconnectFromAgent), causing crashes:
	//   "Cannot read properties of undefined (reading 'signal')"
	//
	// Instead, we set a pending nudge message that gets injected on the
	// next before_agent_start, guiding the agent to use `compress` manually.
	// -----------------------------------------------------------------------

	pi.on("turn_end", (_event: TurnEndEvent, ctx: ExtensionContext) => {
		try {
			ensureInitialized(ctx);
			const usage = ctx.getContextUsage();

			// Get summary buffer tokens for effective threshold calculation
			const sessionId = getSessionId(ctx);
			const summaryTokens = getSummaryTokens(sessionId);

			const nudgeResult = nudgeManager.check(
				usage?.tokens ?? null,
				usage?.percent ?? null,
				currentTurn,
				summaryTokens,
			);

			// Show status in footer (if UI available)
			// setStatus(key, text) — key identifies the status slot
			if (ctx.hasUI && nudgeResult.shouldUpdateStatus) {
				try {
					ctx.ui.setStatus("dcp", nudgeResult.statusText);
				} catch {
					// setStatus may not be available in all UI modes
				}
			}

			// NOTE: nudgeResult.shouldAutoCompact is still tracked internally
			// but we convert it to a critical nudge instead of calling ctx.compact().
			// Pi's native compaction.enabled + reserveTokens handles the actual compaction.

			// Set pending nudge for next before_agent_start
			if (nudgeResult.shouldNudge && nudgeResult.nudgeMessage) {
				nudgeManager.setPendingNudge(nudgeResult.nudgeMessage);
			} else if (nudgeResult.shouldAutoCompact) {
				// Convert auto-compact trigger into a critical nudge instead
				const tokens = usage?.tokens ?? 0;
				const percent = usage?.percent ?? 0;
				nudgeManager.setPendingNudge(
					`[DCP CRITICAL] Context at ${Math.round(tokens / 1000)}k tokens (${Math.round(percent)}%). ` +
					`Pi's auto-compaction will handle this, but you should also compress completed phases NOW ` +
					`using the \`compress\` tool to preserve important context before auto-compaction runs.`
				);
			}
		} catch {
			// Best-effort nudging
		}
	});

	// -----------------------------------------------------------------------
	// EVENT: before_agent_start — Inject nudges and facts into context
	// -----------------------------------------------------------------------

	pi.on("before_agent_start", (_event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
		try {
			ensureInitialized(ctx);
			const sessionId = getSessionId(ctx);

			// Check for pending nudge
			const nudge = nudgeManager.consumePendingNudge();

			// Get facts summary for context enrichment
			const factsSummary = getFactsSummary(sessionId);

			// Get active DCP block summaries (survives compaction by re-injection)
			const activeBlocks = getActiveBlocks(sessionId);
			let blocksSummary: string | null = null;
			if (activeBlocks.length > 0) {
				const blockLines = activeBlocks.map(
					(b) => `[b${b.block_id}: ${b.topic}]\n${b.summary}`,
				);
				blocksSummary = `## Active Compression Blocks\n${blockLines.join("\n\n")}`;
			}

			// Build injected content
			const parts: string[] = [];
			if (blocksSummary) {
				parts.push(blocksSummary);
			}
			if (factsSummary) {
				parts.push(factsSummary);
			}
			if (nudge) {
				parts.push(nudge);
			}

			if (parts.length > 0) {
				const result: BeforeAgentStartEventResult = {
					message: {
						customType: "dcp-context",
						content: parts.join("\n\n"),
						display: false, // Don't show in UI — agent-only context
					},
				};
				return result;
			}
		} catch {
			// Best-effort injection
		}
		return undefined;
	});

	// -----------------------------------------------------------------------
	// EVENT: session_before_compact — DCP-enriched compaction
	//
	// When DCP intercepts native compaction, it generates a richer summary by:
	//   1. Injecting active DCP compression blocks (authoritative earlier-phase summaries)
	//   2. Injecting extracted facts (architecture decisions, constraints, etc.)
	//   3. Using serializeConversation(convertToLlm()) for proper message serialization
	//   4. Respecting event.customInstructions from /compact <instructions>
	//   5. Storing details.mode="dcp-enriched" so session_compact can detect it
	//
	// Falls back to undefined (defers to Pi native compaction) if enriched compaction fails
	// (no model, auth unavailable, or generation error). NEVER returns { cancel: true }
	// without a compaction — that aborts compaction entirely, leaving context unbounded.
	//
	// IMPORTANT: We never call ctx.compact() from event handlers — it races with the
	// agent loop and causes crashes. This hook is the safe interception point.
	// -----------------------------------------------------------------------

	pi.on("session_before_compact", async (event: SessionBeforeCompactEvent, ctx: ExtensionContext) => {
		const cancelPolicy = config.autoCompact.cancelNativeCompaction;

		// "never" means hands-off completely — skip fallbacks too.
		if (cancelPolicy === "never") {
			return undefined;
		}

		// Determine whether DCP should intercept with the *primary* model.
		let shouldIntercept = cancelPolicy === "always";
		if (cancelPolicy === "when-managed") {
			try {
				const sessionId = getSessionId(ctx);
				const activeBlocks = getActiveBlocks(sessionId);
				shouldIntercept = activeBlocks.length > 0;
			} catch {
				shouldIntercept = false;
			}
		}

		// Inner helper: run generateDCPEnrichedCompaction for any resolved model+auth.
		// Returns the compaction result on success, null when the generator returns
		// nothing, or throws on hard error (caller decides whether to continue).
		const tryWith = async (
			m: Parameters<typeof generateDCPEnrichedCompaction>[4],
			a: { apiKey: string | undefined; headers: Record<string, string> | undefined },
		) => {
			const sessionId = getSessionId(ctx);
			return generateDCPEnrichedCompaction(
				sessionId,
				event.preparation as any,
				event.customInstructions,
				event.signal,
				m,
				a.apiKey,
				a.headers,
				config,
			);
		};

		// --- 1. Primary model (only when policy says we should intercept) ---
		if (shouldIntercept) {
			const model = ctx.model;
			if (!model) {
				if (config.debug) console.log("[dcp] No primary model — will try fallbacks");
			} else {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
				if (!auth.ok) {
					if (config.debug) console.log(`[dcp] Primary model auth unavailable (${auth.error}) — will try fallbacks`);
				} else {
					try {
						if (ctx.hasUI) {
							try { ctx.ui.notify("DCP: generating enriched compaction summary...", "info"); } catch {}
						}
						const result = await tryWith(model, auth);
						if (result) {
							if (config.debug) console.log("[dcp] Enriched compaction succeeded (primary)");
							if (ctx.hasUI) {
								try { ctx.ui.notify("DCP: enriched compaction complete", "info"); } catch {}
							}
							return { compaction: result } as SessionBeforeCompactResult;
						}
						if (config.debug) console.log("[dcp] Primary model returned null — will try fallbacks");
					} catch (err) {
						if (config.debug) console.error("[dcp] Enriched compaction error (primary):", err);
						if (ctx.hasUI) {
							try { ctx.ui.notify(`DCP: enriched compaction failed (primary) — trying fallback models`, "warning"); } catch {}
						}
					}
				}
			}
		}

		// --- 2. Fallback models ---
		// Runs even when shouldIntercept=false so a rate-limited primary quota
		// (the scenario that triggered this code path) still gets a usable
		// compaction rather than handing off to Pi native which would hit the
		// same exhausted model and fail identically.
		const fallbacks = config.autoCompact.fallbackModels ?? [];
		for (const fb of fallbacks) {
			try {
				const fbModel = ctx.modelRegistry.find(fb.provider, fb.modelId);
				if (!fbModel) {
					if (config.debug) console.log(`[dcp] Fallback model not found: ${fb.provider}/${fb.modelId}`);
					continue;
				}
				const fbAuth = await ctx.modelRegistry.getApiKeyAndHeaders(fbModel);
				if (!fbAuth.ok) {
					if (config.debug) console.log(`[dcp] Fallback ${fb.provider}/${fb.modelId} auth unavailable: ${fbAuth.error}`);
					continue;
				}
				if (ctx.hasUI) {
					try { ctx.ui.notify(`DCP: retrying compaction with fallback model (${fb.modelId})...`, "info"); } catch {}
				}
				const result = await tryWith(fbModel, fbAuth);
				if (result) {
					if (config.debug) console.log(`[dcp] Enriched compaction succeeded (fallback: ${fb.provider}/${fb.modelId})`);
					if (ctx.hasUI) {
						try { ctx.ui.notify(`DCP: enriched compaction complete (fallback: ${fb.modelId})`, "info"); } catch {}
					}
					return { compaction: result } as SessionBeforeCompactResult;
				}
				if (config.debug) console.log(`[dcp] Fallback ${fb.provider}/${fb.modelId} returned null`);
			} catch (err) {
				if (config.debug) console.error(`[dcp] Enriched compaction error (fallback: ${fb.provider}/${fb.modelId}):`, err);
			}
		}

		// All options exhausted — fall through to Pi native compaction.
		// IMPORTANT: never return { cancel: true } without a compaction object;
		// that tells Pi to abort the compaction entirely, leaving context unbounded.
		if (config.debug) console.log("[dcp] All enriched compaction options exhausted, deferring to Pi native");
		return undefined;
	});

	// -----------------------------------------------------------------------
	// EVENT: session_before_tree — Inject DCP block context into branch summaries
	//
	// When user navigates with /tree and chooses to summarize the abandoned branch,
	// inject active DCP compression blocks as additional context so the branch
	// summary is aware of earlier compressed phases.
	// -----------------------------------------------------------------------

	pi.on("session_before_tree", async (event: SessionBeforeTreeEvent, ctx: ExtensionContext) => {
		try {
			const { preparation } = event;

			// Only inject when user actually wants a branch summary
			if (!preparation.userWantsSummary) return undefined;

			ensureInitialized(ctx);
			const sessionId = getSessionId(ctx);
			const activeBlocks = getActiveBlocks(sessionId);
			if (activeBlocks.length === 0) return undefined;

			// Append DCP block summaries to existing customInstructions (if any)
			const blockLines = activeBlocks
				.map((b) => `[b${b.block_id}: ${b.topic}]\n${b.summary}`)
				.join("\n\n");
			const dcpContext = `Include these DCP compression blocks in your summary (authoritative summaries of completed work phases):\n\n${blockLines}`;

			const combined = preparation.customInstructions
				? `${preparation.customInstructions}\n\n${dcpContext}`
				: dcpContext;

			return { customInstructions: combined } as SessionBeforeTreeResult;
		} catch {
			return undefined;
		}
	});

	// -----------------------------------------------------------------------
	// EVENT: session_compact — Post-compaction cleanup + fact extraction
	// -----------------------------------------------------------------------

	pi.on("session_compact", (event: SessionCompactEvent, ctx: ExtensionContext) => {
		try {
			ensureInitialized(ctx);
			const sessionId = getSessionId(ctx);

			// Extract facts from the compaction summary
			if (event.compactionEntry?.summary && config.factExtraction.enabled) {
				const factsCount = extractFacts(sessionId, event.compactionEntry.summary, config);
				if (config.debug && factsCount > 0) {
					console.log(`[dcp] Extracted ${factsCount} facts from compaction`);
				}
			}

			// Reset session state (tool calls, tags, drop queue).
			// Only deactivate DCP blocks when DCP itself provided the enriched compaction.
			// Other extension compactions (notably pi-vcc) do NOT include DCP block summaries,
			// so blocks must stay active and continue being re-injected via before_agent_start.
			const details = event.compactionEntry?.details as { mode?: string } | undefined;
			const wasDcpEnrichedCompaction = details?.mode === "dcp-enriched";
			resetSessionState(sessionId, wasDcpEnrichedCompaction);
			currentTurn = 0;

			// Reset nudge state
			nudgeManager.reset();
			lastStrategyResult = null;
		} catch {
			// best-effort reset
		}
	});

	// -----------------------------------------------------------------------
	// COMMAND: /dcp — Enhanced status with v2 stats
	// -----------------------------------------------------------------------

	pi.registerCommand("dcp", {
		description: "Show DCP v2 context pruning status and statistics",
		async handler(_args: string, ctx: ExtensionCommandContext) {
			try {
				const stats = getGlobalStats();
				const sessionId = getSessionId(ctx);
				const activeBlocks = getActiveBlocks(sessionId);
				const summaryTokens = getSummaryTokens(sessionId);
				const summaryBufferPct = Math.round((summaryTokens / config.compress.summaryBuffer) * 100);
				const usage = ctx.getContextUsage();
				const nudgeState = nudgeManager.getState();

				const priorityMap = nudgeManager.getPriorityMap();
				const summaryExtension = Math.min(summaryTokens, config.compress.summaryBuffer);
				const effectiveMax = config.compress.maxContextLimit + summaryExtension;

				const lines = [
					"## DCP v2 Status",
					"",
					"### Context",
					`**Tokens**: ${usage?.tokens != null ? `~${Math.round(usage.tokens / 1000)}k` : "unknown"}`,
					`**Usage**: ${usage?.percent != null ? `${Math.round(usage.percent)}%` : "unknown"}`,
					`**Context window**: ${usage?.contextWindow ? `${Math.round(usage.contextWindow / 1000)}k` : "unknown"}`,
					`**Summary buffer**: ~${summaryTokens}/${config.compress.summaryBuffer} (${summaryBufferPct}%)`,
					`**Effective max**: ~${Math.round(effectiveMax / 1000)}k (base ${Math.round(config.compress.maxContextLimit / 1000)}k + ${Math.round(summaryExtension / 1000)}k summary buffer)`,
					"",
					"### Runtime Strategies",
					`**Auto-prunes total**: ${stats.totalAutoPrunes}`,
					`**Tokens saved by auto-prune**: ~${stats.totalPrunedTokens}`,
					`**Supersede writes**: ${config.strategies.supersedeWrites.enabled ? `active (${config.strategies.supersedeWrites.turns} turn min age)` : "off"}`,
					`**Last pass**: ${lastStrategyResult ? `${lastStrategyResult.prunedCount} items (~${lastStrategyResult.prunedTokens} tokens)` : "none"}`,
					"",

					"### Facts",
					`**Facts extracted**: ${stats.totalFactsExtracted}`,
					"",
					"### Nudge System",
					`**Last context**: ${nudgeState.lastContextTokens != null ? `~${Math.round(nudgeState.lastContextTokens / 1000)}k (${Math.round(nudgeState.lastContextPercent ?? 0)}%)` : "no data"}`,
					`**Summary buffer used**: ${nudgeState.summaryTokens > 0 ? `~${Math.round(nudgeState.summaryTokens / 1000)}k (extends effective max)` : "0"}`,
					"",
					...(nudgeState.priorityMap && nudgeState.priorityMap.topTargets.length > 0 ? [
						"### Priority Map",
						...nudgeState.priorityMap.topTargets.map((t: string) => `  • ${t}`),
						"",
					] : []),
					"### Compression History",
					`**Sessions**: ${stats.totalSessions}`,
					`**Total compressions**: ${stats.totalCompressions}`,
					`**Tokens compressed**: ~${stats.totalCompressedTokens}`,
					`**Mode**: ${config.compress.mode}`,
					"",
					`**Active blocks**: ${activeBlocks.length}`,
					...activeBlocks.map(
						(b) => `  b${b.block_id}: "${b.topic}" (~${b.compressed_tokens} tokens)`,
					),
					"",
					"### Config Highlights",

					`**Fact extraction**: ${config.factExtraction.enabled ? "enabled" : "disabled"}`,
					`**Expand (reversible)**: ${config.expand.enabled ? "enabled" : "disabled"}`,
					`**Pi native compaction**: ${config.autoCompact.cancelNativeCompaction === "always" ? "BLOCKED by DCP (manual compress only)" : config.autoCompact.cancelNativeCompaction === "when-managed" ? "blocked when DCP has active blocks" : "handles auto-compact (DCP provides nudges only)"}`,
				];

				ctx.ui.notify(lines.join("\n"), "info");
			} catch (err) {
				try {
					ctx.ui.notify(`DCP status error: ${err}`, "error");
				} catch {
					// no UI
				}
			}
		},
	});

	// -----------------------------------------------------------------------
	// Cleanup on shutdown
	// -----------------------------------------------------------------------

	pi.on("session_shutdown", () => {
		closeDCPDB();
	});
}

// ---------------------------------------------------------------------------
// ctx_expand tool — Reversible compression
// ---------------------------------------------------------------------------

function registerExpandTool(pi: ExtensionAPI, config: DCPConfig): void {
	if (!config.expand.enabled) return;

	pi.registerTool({
		name: "ctx_expand",
		label: "Expand Compressed Block",
		description: [
			"Decompress a previously compressed conversation block back to its raw transcript.",
			"Use when you need exact details from a compressed range that the summary doesn't cover.",
			"The raw transcript is stored before compaction and may be truncated to fit token limits.",
			"",
			"Usage: ctx_expand({ blockId: 3 }) — expands block b3",
		].join("\n"),
		promptSnippet: "Decompress a DCP block to see raw transcript.",
		parameters: Type.Object({
			blockId: Type.Integer({
				minimum: 1,
				description: "Block ID to expand (e.g., 3 for block b3)",
			}),
		}),
		async execute(
			_toolCallId: string,
			params: { blockId: number },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
			if (!Number.isInteger(params.blockId) || params.blockId < 1) {
				throw new Error(`Invalid blockId: ${params.blockId}. Must be a positive integer ≥ 1 (e.g. 3 for block b3).`);
			}
			const sessionId = getSessionId(ctx);
			const expanded = expandCompressedBlock(
				sessionId,
				params.blockId,
				config.expand.maxExpandTokens,
			);

			if (!expanded) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No raw transcript found for block b${params.blockId}. The block may not exist or was created before expansion tracking was enabled.`,
						},
					],
					details: undefined,
				};
			}

			return {
				content: [
					{
						type: "text" as const,
						text: [
							`[Expanded block b${params.blockId}]`,
							`Max tokens: ${config.expand.maxExpandTokens}`,
							"",
							"--- Raw Transcript ---",
							"",
							expanded,
						].join("\n"),
					},
				],
				details: { blockId: params.blockId },
			};
		},
	});
}
