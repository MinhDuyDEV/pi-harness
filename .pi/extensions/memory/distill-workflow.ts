/**
 * Auto-Distill — Workflow Pattern Detection & Skill Generation
 *
 * Scans session traces (temporal_messages) to detect repeated manual workflows,
 * then packages high-confidence candidates into reusable skills.
 * Runs on agent_end at configured interval (default: monthly).
 * No user-facing command.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { MEMORY_CONFIG } from "./config.js";
import { getMemoryDB } from "./db.js";
import { tokenize } from "./distill.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface WorkflowPattern {
  id: string;
  name: string;
  toolSequence: string[];
  frequency: number;
  contextTerms: string[];
  confidence: number;
  sessionIds: string[];
  lastObserved: number;
}

export interface PatternDetectionResult {
  patterns: WorkflowPattern[];
  totalSessionsScanned: number;
  totalMessagesScanned: number;
}

export interface GeneratedSkill {
  name: string;
  description: string;
  content: string;
  path: string;
}

export interface DistillResult {
  patternsFound: number;
  skillsGenerated: number;
  generatedSkills: GeneratedSkill[];
  sessionCount: number;
}

// ── Config ──────────────────────────────────────────────────────────────────

const DISTILL_CONFIG = {
  minFrequency: 3,
  minConfidence: 0.6,
  minSequenceLength: 3,
  maxSequenceLength: 8,
  windowSize: 5,
  maxSessions: 50,
  maxMessagesPerSession: 200,
};

// ── Pattern Detection ───────────────────────────────────────────────────────

function extractToolSequences(
  messages: Array<{ tool_name: string | null; content: string; time_created: number }>,
): string[][] {
  const sequences: string[][] = [];
  let currentSequence: string[] = [];

  for (const msg of messages) {
    if (msg.tool_name && !["observation", "memory-search", "memory-admin"].includes(msg.tool_name)) {
      currentSequence.push(msg.tool_name);
    } else if (currentSequence.length >= DISTILL_CONFIG.minSequenceLength) {
      sequences.push([...currentSequence]);
      currentSequence = [];
    } else {
      currentSequence = [];
    }
  }
  if (currentSequence.length >= DISTILL_CONFIG.minSequenceLength) {
    sequences.push([...currentSequence]);
  }

  // Sliding window
  const windowed: string[][] = [];
  for (const seq of sequences) {
    if (seq.length <= DISTILL_CONFIG.maxSequenceLength) windowed.push(seq);
    else {
      for (let i = 0; i <= seq.length - DISTILL_CONFIG.windowSize; i++) {
        windowed.push(seq.slice(i, i + DISTILL_CONFIG.windowSize));
      }
    }
  }
  return windowed;
}

function extractPatternContext(
  patternMessages: Array<{ content: string }>,
  allMessages: Array<{ content: string }>,
  topN: number,
): string[] {
  const patternDocs = patternMessages.map((m) => tokenize(m.content));
  const allDocs = allMessages.map((m) => tokenize(m.content));

  const tf = new Map<string, number>();
  for (const doc of patternDocs) for (const word of doc) tf.set(word, (tf.get(word) ?? 0) + 1);
  const totalPatternTerms = Math.max(patternDocs.flat().length, 1);

  const docFreq = new Map<string, number>();
  for (const doc of allDocs) {
    const unique = new Set(doc);
    for (const word of unique) docFreq.set(word, (docFreq.get(word) ?? 0) + 1);
  }

  const N = allDocs.length;
  const scores = new Map<string, number>();
  for (const [word, count] of tf) {
    const df = docFreq.get(word) ?? 1;
    const tfScore = Math.log(1 + count / totalPatternTerms);
    const idfScore = Math.log(N / df);
    scores.set(word, tfScore * idfScore);
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word);
}

export function detectPatterns(sessionIds?: string[]): PatternDetectionResult {
  const db = getMemoryDB();

  let rows: Array<{ session_id: string; time_created: number }>;
  if (sessionIds && sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => "?").join(",");
    rows = db.prepare(
      `SELECT DISTINCT session_id, MIN(time_created) as time_created FROM temporal_messages WHERE session_id IN (${placeholders}) GROUP BY session_id ORDER BY time_created DESC`,
    ).all(...sessionIds) as Array<{ session_id: string; time_created: number }>;
  } else {
    rows = db.prepare(
      `SELECT session_id, MIN(time_created) as time_created FROM temporal_messages GROUP BY session_id ORDER BY time_created DESC LIMIT ?`,
    ).all(DISTILL_CONFIG.maxSessions) as Array<{ session_id: string; time_created: number }>;
  }

  const sessionToolSequences: Array<{
    session_id: string;
    sequences: string[][];
    messages: Array<{ content: string; tool_name: string | null; time_created: number }>;
  }> = [];

  for (const row of rows) {
    const messages = db.prepare(
      `SELECT tool_name, content, time_created FROM temporal_messages WHERE session_id = ? AND tool_name IS NOT NULL ORDER BY time_created ASC LIMIT ?`,
    ).all(row.session_id, DISTILL_CONFIG.maxMessagesPerSession) as Array<{ tool_name: string | null; content: string; time_created: number }>;

    if (messages.length < DISTILL_CONFIG.minSequenceLength) continue;
    const sequences = extractToolSequences(messages);
    if (sequences.length > 0) {
      sessionToolSequences.push({ session_id: row.session_id, sequences, messages });
    }
  }

  const sequenceCounts = new Map<string, { count: number; sessionIds: Set<string>; messages: Array<{ content: string; time_created?: number }> }>();
  for (const sess of sessionToolSequences) {
    const seen = new Set<string>();
    for (const seq of sess.sequences) {
      const key = seq.join("→");
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = sequenceCounts.get(key) ?? { count: 0, sessionIds: new Set(), messages: [] };
      entry.count++;
      entry.sessionIds.add(sess.session_id);
      const repMsgs = sess.messages.filter((m) => seq.includes(m.tool_name ?? "")).slice(0, 5);
      entry.messages.push(...repMsgs);
      sequenceCounts.set(key, entry);
    }
  }

  const allMessages = sessionToolSequences.flatMap((s) => s.messages);
  const patterns: WorkflowPattern[] = [];
  const totalMessagesScanned = sessionToolSequences.reduce((s, sess) => s + sess.messages.length, 0);

  for (const [sequenceKey, data] of sequenceCounts) {
    if (data.count < DISTILL_CONFIG.minFrequency) continue;
    const tools = sequenceKey.split("→");
    const confidence = Math.min(1.0,
      (data.count / DISTILL_CONFIG.minFrequency) * 0.5 +
      (data.sessionIds.size / Math.max(1, sessionToolSequences.length)) * 0.3 +
      (tools.length / DISTILL_CONFIG.maxSequenceLength) * 0.2,
    );

    const uniqueTools = [...new Set(tools)];
    const name = uniqueTools.length <= 2
      ? `${uniqueTools.join("-")} workflow`
      : `${uniqueTools.slice(0, 3).join("-")} workflow (${uniqueTools.length} tools)`;

    const contextTerms = extractPatternContext(data.messages.slice(0, 30), allMessages, 10);

    patterns.push({
      id: `pat-${Buffer.from(sequenceKey).toString("base64").slice(0, 8)}`,
      name,
      toolSequence: tools,
      frequency: data.count,
      contextTerms,
      confidence,
      sessionIds: [...data.sessionIds],
      lastObserved: Math.max(
        ...data.messages.map((m) => m.time_created ?? 0),
      ),
    });
  }

  patterns.sort((a, b) => b.confidence - a.confidence);
  return { patterns, totalSessionsScanned: sessionToolSequences.length, totalMessagesScanned };
}

// ── Skill Generation ────────────────────────────────────────────────────────

function generateSkillFromPattern(pattern: WorkflowPattern): GeneratedSkill {
  const toolList = [...new Set(pattern.toolSequence)].join(", ");
  const termList = pattern.contextTerms.slice(0, 5).join(", ");

  const name = pattern.name
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

  const description = `Automated ${pattern.toolSequence.slice(0, 3).join("-")} workflow pattern (confidence: ${(pattern.confidence * 100).toFixed(0)}%)`;

  const content = [
    `# ${pattern.name} Skill`,
    "",
    "## Description",
    `Detected workflow pattern: ${pattern.toolSequence.join(" → ")}`,
    `Context terms: ${termList}`,
    `Frequency: ${pattern.frequency}x in ${pattern.sessionIds.length} sessions`,
    `Confidence: ${(pattern.confidence * 100).toFixed(0)}%`,
    "",
    "## When to Use",
    `Use when: ${termList.replace(/,/g, " or")}`,
    `Tools: ${toolList}`,
    "",
    "## Steps",
    ...pattern.toolSequence.map((t, i) => `${i + 1}. Use \`${t}\` tool`),
    "",
    "## Auto-Generated",
    `Generated from ${pattern.frequency} observed executions. Review before relying on it.`,
    "",
  ].join("\n");

  return { name, description, content, path: "" };
}

function writeSkillToDisk(skill: GeneratedSkill, piDir: string): string {
  const skillsDir = join(piDir, "agent", "skills", "auto-distilled");
  if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true });
  const filePath = join(skillsDir, `${skill.name}.md`);
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf-8");
    if (existing === skill.content) return filePath;
  }
  writeFileSync(filePath, skill.content, "utf-8");
  skill.path = filePath;
  return filePath;
}

// ── Main Distill Entry Point ────────────────────────────────────────────────

export function runDistillCycle(piDir?: string): DistillResult {
  if (!MEMORY_CONFIG.distillation.enabled) {
    return { patternsFound: 0, skillsGenerated: 0, generatedSkills: [], sessionCount: 0 };
  }

  const result = detectPatterns();
  const generatedSkills: GeneratedSkill[] = [];

  for (const pattern of result.patterns) {
    if (pattern.confidence >= DISTILL_CONFIG.minConfidence) {
      const skill = generateSkillFromPattern(pattern);
      generatedSkills.push(skill);
      if (piDir) writeSkillToDisk(skill, piDir);
    }
  }

  return {
    patternsFound: result.patterns.length,
    skillsGenerated: generatedSkills.length,
    generatedSkills,
    sessionCount: result.totalSessionsScanned,
  };
}

// ── Auto-Trigger ────────────────────────────────────────────────────────────

let lastDistillTime = 0;
const MIN_DISTILL_GAP_MS = 10_000;
const DISTILL_INTERVAL_DAYS = 30;
const DISTILL_DAY_MS = 24 * 60 * 60 * 1000;

export function shouldAutoDistill(): boolean {
  if (!MEMORY_CONFIG.distillation.enabled) return false;
  const now = Date.now();
  if (now - lastDistillTime < MIN_DISTILL_GAP_MS) return false;

  const intervalMs = DISTILL_INTERVAL_DAYS * DISTILL_DAY_MS;
  const db = getMemoryDB();
  const lastGenerated = db.prepare(
    `SELECT time_created FROM temporal_messages WHERE tool_name = 'distill' ORDER BY time_created DESC LIMIT 1`,
  ).get() as { time_created: number } | undefined;

  const elapsed = lastGenerated ? now - lastGenerated.time_created : Infinity;
  if (elapsed < intervalMs) return false;

  const earliest = db.prepare(`SELECT MIN(time_created) as earliest FROM temporal_messages`).get() as { earliest: number | null } | undefined;
  if (!earliest?.earliest || now - earliest.earliest < intervalMs) return false;

  lastDistillTime = now;
  return true;
}

export function autoDistillCycle(piDir?: string): string {
  if (!shouldAutoDistill()) return "";
  const result = runDistillCycle(piDir);

  // Record that distillation ran so shouldAutoDistill can throttle
  const db = getMemoryDB();
  const markerTime = Date.now();
  db.prepare(
    `INSERT INTO temporal_messages (message_id, session_id, role, tool_name, content, token_estimate, time_created)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `distill-${markerTime}`,
    "__distill_marker__",
    "assistant",
    "distill",
    "auto-distill-cycle",
    1,
    markerTime,
  );

  const parts: string[] = [];
  if (result.patternsFound > 0) parts.push(`distill: ${result.patternsFound} patterns from ${result.sessionCount} sessions`);
  if (result.skillsGenerated > 0) parts.push(`${result.skillsGenerated} skills generated`);
  return parts.length > 0 ? parts.join(", ") : "";
}
