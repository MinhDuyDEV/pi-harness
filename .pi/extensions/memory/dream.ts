/**
 * Auto-Dream — Memory Consolidation Agent
 *
 * Scans accumulated session traces (temporal_messages) and consolidates
 * durable knowledge into observations. Runs on agent_end at configured
 * interval (default: weekly). No user-facing command.
 */

import { MEMORY_CONFIG } from "./config.js";
import { getMemoryDB } from "./db.js";
import { getUndistilledMessages, getUndistilledMessageCount } from "./pipeline.js";
import { extractTopTerms } from "./distill.js";
import { storeObservation } from "./observations.js";

let lastDreamTime = 0;
const MIN_DREAM_GAP_MS = 10_000;

function buildDreamSummary(
  messages: Array<{ content: string; tool_name: string | null; time_created: number }>,
  topTerms: string[],
): string {
  const termSet = new Set(topTerms);
  interface ScoredMsg { content: string; score: number; time: number }
  const scored: ScoredMsg[] = messages
    .filter((m) => m.content && m.content.length > 20)
    .map((m) => {
        const lower = m.content.toLowerCase();
        const hits = topTerms.filter((t) => lower.includes(t)).length;
        const density = m.content.length > 0 ? hits / (m.content.length / 100) : 0;
        return { content: m.content, score: density, time: m.time_created ?? Date.now() };
      })
    .sort((a, b) => b.score - a.score);

  const MAX_DREAM_CHARS = 4000;
  const selected: ScoredMsg[] = [];
  let totalChars = 0;
  for (const msg of scored) {
    if (totalChars + msg.content.length > MAX_DREAM_CHARS) continue;
    const lower = msg.content.toLowerCase().slice(0, 100);
    if (selected.some((s) => s.content.toLowerCase().slice(0, 100) === lower)) continue;
    selected.push(msg);
    totalChars += msg.content.length;
  }
  selected.sort((a, b) => a.time - b.time);
  return selected.map((s) => s.content).join("\n\n---\n\n");
}

export interface DreamResult {
  observationsCreated: number;
  sessionsDreamed: number;
  messagesScanned: number;
}

export function dreamSession(sessionId: string): number {
  if (!(MEMORY_CONFIG as any).dream.enabled) return 0;
    const { minMessagesPerSession, topTerms } = (MEMORY_CONFIG as any).dream;

    const undistilledCount = getUndistilledMessageCount(sessionId);
  if (undistilledCount < minMessagesPerSession) return 0;

  const messages = getUndistilledMessages(sessionId, 100);
  if (messages.length < minMessagesPerSession) return 0;

  const terms = extractTopTerms(messages, topTerms);
  const summary = buildDreamSummary(messages, terms);
  if (summary.length < 100) return 0;

  const lower = summary.toLowerCase();
  const hasBug = /bug|fix|error|crash|fail|wrong|incorrect/i.test(lower);
  const hasDecision = /decide|choose|pick|select|use\s+\w+\s+instead/i.test(lower);
  const hasDiscovery = /found|discovered|learned|realized|turns\s+out|actually/i.test(lower);
  const hasWarning = /warning|caut|careful|gotcha|trap|pitfall/i.test(lower);

  const concepts = terms.slice(0, 5);
  let createdCount = 0;

  if (hasDecision && terms.length > 0) {
    storeObservation({
      type: "decision", title: `Decision: ${terms.slice(0, 3).join(", ")}`,
      narrative: summary.slice(0, 500), concepts, source: "curator", confidence: "medium",
    });
    createdCount++;
  }
  if (hasDiscovery) {
    storeObservation({
      type: "discovery", title: `Discovery: ${terms.slice(0, 3).join(", ")}`,
      narrative: summary.slice(0, 500), concepts, source: "curator", confidence: "medium",
    });
    createdCount++;
  }
  if (hasBug) {
    storeObservation({
      type: "bugfix", title: `Bugfix: ${terms.slice(0, 3).join(", ")}`,
      narrative: summary.slice(0, 500), concepts, source: "curator", confidence: "medium",
    });
    createdCount++;
  }
  if (hasWarning) {
    storeObservation({
      type: "warning", title: `Warning: ${terms.slice(0, 3).join(", ")}`,
      narrative: summary.slice(0, 500), concepts, source: "curator", confidence: "medium",
    });
    createdCount++;
  }
  if (createdCount === 0 && summary.length > 300) {
    storeObservation({
      type: "learning", title: terms.slice(0, 3).join(", "),
      narrative: summary.slice(0, 500), concepts, source: "curator", confidence: "low",
    });
    createdCount++;
  }
  // Mark messages as processed by dream so they are not re-processed
  if (createdCount > 0) {
    const db = getMemoryDB();
    db.prepare(`UPDATE temporal_messages SET distillation_id = -1 WHERE session_id = ? AND distillation_id IS NULL`).run(sessionId);
  }
  return createdCount;
}


const DAY_MS = 24 * 60 * 60 * 1000;

export function shouldAutoDream(): boolean {
  const cfg = (MEMORY_CONFIG as any).dream;
  if (!cfg.enabled || !cfg.auto) return false;
  const now = Date.now();
  if (now - lastDreamTime < MIN_DREAM_GAP_MS) return false;

  const intervalMs = cfg.interval_days * DAY_MS;
  const db = getMemoryDB();
  const lastDream = db.prepare(
    `SELECT created_at_epoch FROM observations WHERE source = 'curator' ORDER BY created_at_epoch DESC LIMIT 1`,
  ).get() as { created_at_epoch: number } | undefined;

  const elapsed = lastDream ? now - lastDream.created_at_epoch : Infinity;
  if (!lastDream) {
    const earliest = db.prepare(`SELECT MIN(time_created) as earliest FROM temporal_messages`).get() as { earliest: number | null } | undefined;
    if (!earliest?.earliest || now - earliest.earliest < intervalMs) return false;
  }
  if (elapsed < intervalMs) return false;
  lastDreamTime = now;
  return true;
}

export function autoDreamCycle(): DreamResult {
  if (!shouldAutoDream()) return { observationsCreated: 0, sessionsDreamed: 0, messagesScanned: 0 };
  const db = getMemoryDB();
  const { minMessagesPerSession } = (MEMORY_CONFIG as any).dream;
  const sessions = db.prepare(
    `SELECT session_id, COUNT(*) as count FROM temporal_messages WHERE distillation_id IS NULL GROUP BY session_id HAVING count >= ? ORDER BY MAX(time_created) DESC LIMIT 10`,
  ).all(minMessagesPerSession) as Array<{ session_id: string; count: number }>;
  if (sessions.length === 0) return { observationsCreated: 0, sessionsDreamed: 0, messagesScanned: 0 };

  let totalObservations = 0, sessionsDreamed = 0, totalMessagesScanned = 0;
  for (const sess of sessions) {
    const created = dreamSession(sess.session_id);
    if (created > 0) sessionsDreamed++;
    totalObservations += created;
    totalMessagesScanned += sess.count;
  }
  return { observationsCreated: totalObservations, sessionsDreamed, messagesScanned: totalMessagesScanned };
}
