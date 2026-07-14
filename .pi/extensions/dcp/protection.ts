/**
 * Protection Policy for DCP — shared side-channel computed once per strategy run.
 *
 * Each compression strategy (applyCompressStrip, applyDedup, applyPurgeErrors,
 * pruneToolResults) consults the policy before removing/pruning content.
 *
 * Protection is based on object identity (WeakSet), not array indices,
 * so it remains stable even when applyCompressStrip removes messages
 * from the array.
 *
 * No ad-hoc metadata is ever set on Pi Message objects.
 */

import type {
  Message,
  AssistantMessage,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { DCPConfig } from "./config.js";
import type { ProtectionProvenance } from "./compress-types.js";

// ---------------------------------------------------------------------------
// Protection policy (immutable after construction)
// ---------------------------------------------------------------------------

/**
 * Immutable set of message objects that are protected from removal/pruning/stripping
 * by any compression strategy. Uses WeakSet for object identity tracking so that
 * protection survives array mutations (e.g., compress-strip removing unprotected messages).
 */
export class ProtectionPolicy {
  /** WeakSet of message objects protected by any reason */
  readonly protectedMessages: WeakSet<Message>;
  /** Aggregate counts for provenance metadata */
  readonly provenance: ProtectionProvenance;

  constructor(
    protectedMessages: WeakSet<Message>,
    provenance: ProtectionProvenance,
  ) {
    this.protectedMessages = protectedMessages;
    this.provenance = provenance;
  }

  /** True when `message` is protected */
  isProtected(message: Message): boolean {
    return this.protectedMessages.has(message);
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const PATH_LIKE_KEYS = new Set([
  "path",
  "file",
  "directory",
  "dir",
  "target",
  "source",
  "destination",
  "dest",
  "oldPath",
  "newPath",
  "movePath",
  "location",
  "root",
  "output",
  "input",
  "entry",
  "entries",
]);

/**
 * True when a key should be treated as path-like for protection matching.
 * Matches keys ending with "Path"/"path" and exact matches against known keys.
 */
export function isPathLikeKey(key: string): boolean {
  if (PATH_LIKE_KEYS.has(key)) return true;
  if (key.endsWith("Path") || key.endsWith("path")) return true;
  return false;
}

/** Normalize path separators to forward slashes. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Deterministic glob matching (no dependencies)
// Supports *, **, and ? in the small documented subset:
//   *  — matches any characters except /
//   ** — matches any characters including /
//   ?  — matches any single character except /
// ---------------------------------------------------------------------------

/**
 * Match a file path against a glob pattern.  Supports `*`, `**`, and `?`.
 * Path is normalized to forward slashes before matching.
 * Returns `true` when the full path matches the pattern.
 */
export function matchesGlob(path: string, pattern: string): boolean {
  const npath = normalizePath(path);
  const npattern = normalizePath(pattern);

  // Split into segments on /
  const pathSegs = splitSegs(npath);
  const patSegs = splitSegs(npattern);

  return matchSegs(pathSegs, 0, patSegs, 0);
}

function splitSegs(s: string): string[] {
  // Remove leading slash so we don't get an empty first segment
  return s.replace(/^\//, "").split("/");
}

function matchSegs(
  path: string[],
  pi: number,
  pat: string[],
  pj: number,
): boolean {
  // Both exhausted
  if (pi >= path.length && pj >= pat.length) return true;
  // Pattern exhausted while path remains
  if (pj >= pat.length) return false;
  // Path exhausted while pattern remains – only ** segments can match empty
  if (pi >= path.length) {
    for (let i = pj; i < pat.length; i++) {
      if (pat[i] !== "**") return false;
    }
    return true;
  }

  const p = pat[pj];

  if (p === "**") {
    // ** matches zero or more segments
    if (matchSegs(path, pi, pat, pj + 1)) return true; // skip ** (match zero)
    if (matchSegs(path, pi + 1, pat, pj)) return true; // consume one segment
    return false;
  }

  // Regular segment – must match at char level
  if (!matchSeg(path[pi], p)) return false;
  return matchSegs(path, pi + 1, pat, pj + 1);
}

/** Match a single path segment against a pattern (no / allowed inside). */
function matchSeg(seg: string, pat: string): boolean {
  return matchChars(seg, 0, pat, 0);
}

function matchChars(s: string, si: number, p: string, pj: number): boolean {
  // Both exhausted
  if (si >= s.length && pj >= p.length) return true;
  // Pattern exhausted while segment remains
  if (pj >= p.length) return false;
  // Segment exhausted while pattern remains – only trailing * matches empty
  if (si >= s.length) {
    for (let i = pj; i < p.length; i++) {
      if (p[i] !== "*") return false;
    }
    return true;
  }

  const pc = p[pj];
  const sc = s[si];

  if (pc === "*") {
    // * matches zero or more chars (never /, but there are no / in a segment)
    if (matchChars(s, si, p, pj + 1)) return true; // match zero
    if (matchChars(s, si + 1, p, pj)) return true; // consume one
    return false;
  }

  if (pc === "?") {
    // ? matches exactly one char
    return matchChars(s, si + 1, p, pj + 1);
  }

  // Literal match
  if (sc !== pc) return false;
  return matchChars(s, si + 1, p, pj + 1);
}

// ---------------------------------------------------------------------------
// Policy computation
// ---------------------------------------------------------------------------

/**
 * Compute a ProtectionPolicy for a message array.
 *
 * Protection is the union of:
 *   1. compress.protectedTools, dedup.protectedTools, purgeErrors.protectedTools,
 *      and toolResultPruning.protectedTools — tool name matches
 *   2. compress.protectUserMessages — user message preservation
 *   3. protection.protectedFilePatterns — glob-based path protection
 *   4. protection.recentTurns — turn-based protection
 *
 * ToolCall-to-ToolResult pairing is done via toolCallId maps: when an assistant
 * message with tool calls is protected, its matching tool result messages are
 * also protected (and vice versa for recent-turns protection).
 *
 * The returned policy uses WeakSet for object identity tracking. The caller
 * must pass the same message array (or objects from it) to isProtected().
 *
 * Pi Message objects are never mutated.
 */
export function computeProtectionPolicy(
  messages: readonly Message[],
  config: DCPConfig,
): ProtectionPolicy {
  const protectedMessages = new WeakSet<Message>();
  const prov: ProtectionProvenance = {
    protectedTools: 0,
    protectedFiles: 0,
    protectedRecentTurns: 0,
    protectedUserMessages: 0,
  };

  const protectUserMessages = config.compress.protectUserMessages ?? false;
  const filePatterns = config.protection.protectedFilePatterns ?? [];
  const recentTurns = config.protection.recentTurns ?? 3;
  const effectiveRecentTurns = Math.max(recentTurns, 0);

  // Union of all protectedTools from all strategies
  const allProtectedTools = new Set([
    ...(config.compress.protectedTools ?? []),
    ...(config.dedup.protectedTools ?? []),
    ...(config.purgeErrors.protectedTools ?? []),
    ...(config.toolResultPruning.protectedTools ?? []),
  ]);

  // Pre-build toolCallId-to-ToolResultMessage map for pairing
  const resultByCallId = new Map<string, ToolResultMessage>();
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      resultByCallId.set(msg.toolCallId, msg);
    }
  }

  // Track messages already assigned a reason (only count once)
  const alreadyCounted = new WeakSet<Message>();

  function protect(msg: Message, reason: keyof ProtectionProvenance): void {
    if (alreadyCounted.has(msg)) return;
    protectedMessages.add(msg);
    alreadyCounted.add(msg);
    prov[reason]++;
  }

  // -----------------------------------------------------------------------
  // Pass 1: tool name, file pattern, and user message protection
  // -----------------------------------------------------------------------
  for (const msg of messages) {
    // User messages
    if (protectUserMessages && msg.role === "user") {
      protect(msg, "protectedUserMessages");
    }

    // Assistant messages with tool calls
    if (msg.role === "assistant") {
      const asst = msg as AssistantMessage;
      if (!Array.isArray(asst.content)) continue;

      for (const part of asst.content) {
        if (part.type !== "toolCall") continue;
        const tc = part as ToolCall;

        if (allProtectedTools.has(tc.name)) {
          protect(msg, "protectedTools");
          const resultMsg = resultByCallId.get(tc.id);
          if (resultMsg) protect(resultMsg, "protectedTools");
          break; // one reason per assistant message
        }

        if (
          filePatterns.length > 0 &&
          hasMatchingFileArg(tc.arguments, filePatterns)
        ) {
          protect(msg, "protectedFiles");
          const resultMsg = resultByCallId.get(tc.id);
          if (resultMsg) protect(resultMsg, "protectedFiles");
          break; // one reason per assistant message
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Pass 2: recent-turns protection
  // -----------------------------------------------------------------------
  if (effectiveRecentTurns > 0) {
    let turnsFound = 0;
    // Default to protecting everything — when there are fewer turns than
    // effectiveRecentTurns, the entire array is within the recent window.
    let cutoffIndex = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant") {
        const asst = msg as AssistantMessage;
        const hasToolCall =
          Array.isArray(asst.content) &&
          asst.content.some((c) => c.type === "toolCall");
        if (hasToolCall) {
          turnsFound++;
          if (turnsFound >= effectiveRecentTurns) {
            cutoffIndex = i;
            break;
          }
        }
      }
    }

    // Protect all messages at or after the cutoff index
    for (let i = cutoffIndex; i < messages.length; i++) {
      const msg = messages[i];
      protect(msg, "protectedRecentTurns");

      // Also protect any matching tool results for tool calls in this range
      if (msg.role === "assistant") {
        const asst = msg as AssistantMessage;
        if (!Array.isArray(asst.content)) continue;
        for (const part of asst.content) {
          if (part.type === "toolCall") {
            const tc = part as ToolCall;
            const resultMsg = resultByCallId.get(tc.id);
            if (resultMsg) protect(resultMsg, "protectedRecentTurns");
          }
        }
      }
    }
  }

  return new ProtectionPolicy(protectedMessages, prov);
}

// ---------------------------------------------------------------------------
// Argument path-matching helpers
// ---------------------------------------------------------------------------

/**
 * Check whether `arguments` contains any value under a path-like key
 * that matches one of the file patterns.
 *
 * Only path-like argument keys are inspected – shell command strings are
 * never matched.
 */
function hasMatchingFileArg(
  args: Record<string, unknown> | undefined,
  patterns: readonly string[],
): boolean {
  if (!args) return false;

  for (const [key, value] of Object.entries(args)) {
    if (!isPathLikeKey(key)) continue;

    if (typeof value === "string") {
      for (const pattern of patterns) {
        if (matchesGlob(value, pattern)) return true;
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          for (const pattern of patterns) {
            if (matchesGlob(item, pattern)) return true;
          }
        }
      }
    }
  }

  return false;
}
