# Plan: Unified Safety Interface

## Goal

Replace three overlapping safety extensions (guardrails.ts, guardian.ts, sandbox.ts) with a single domain-driven `SafetyGate` that callers use in terms of "Is this action safe?" / "What are the risks?" / "What's the security posture?" — never in terms of regex patterns, SBPL profiles, or event hooks.

## Design Principles

1. **Domain-first** — Types reflect the security domain (threats, verdicts, severity), not implementation (regex, profiles, hooks)
2. **Single entry point** — One `evaluate()` call replaces three separate interceptors
3. **Testable without pi** — `SafetyGate` is a pure class; the pi extension is a thin adapter
4. **No regression** — Every existing rule has a 1:1 mapping in the new model
5. **Unified audit** — One log, not three

---

## Part 1: Domain Types (`safety/types.ts`)

```typescript
// =============================================================================
// DOMAIN TYPES — The language of the security domain
// =============================================================================

// ---------------------------------------------------------------------------
// What the agent wants to do
// ---------------------------------------------------------------------------

/** An action the agent is attempting to perform. */
export interface Action {
  /** Tool being invoked */
  tool: string;                           // "bash" | "write" | "edit" | "TaskUpdate"
  /** Bash command text (when tool === "bash") */
  command?: string;
  /** Target file path (when tool === "write" | "edit") */
  path?: string;
  /** All tool parameters */
  params: Record<string, unknown>;
  /** Session ID for evidence tracking */
  sessionId: string;
}

// ---------------------------------------------------------------------------
// What kind of danger exists
// ---------------------------------------------------------------------------

/**
 * Threat categories — the kinds of bad outcomes we protect against.
 *
 * Each category represents a *class of harm*, not a specific command.
 * Multiple policies can detect the same threat category via different signals.
 */
export type ThreatCategory =
  | "credential-exposure"       // secrets leaked to stdout, files, or logs
  | "data-destruction"          // irreversible deletion of code, data, or state
  | "privilege-escalation"      // running as root or gaining elevated permissions
  | "remote-code-execution"     // downloading and executing untrusted code
  | "workspace-escape"          // writing outside the project boundary
  | "history-rewrite"           // rewriting git history that others depend on
  | "unverified-completion"     // marking work done without evidence
  | "sensitive-modification"    // changing credentials, configs, or security-critical files
  | "network-exfiltration"      // unauthorized outbound network access
  | "registry-publish";         // pushing artifacts to public registries

// ---------------------------------------------------------------------------
// How severe is the risk
// ---------------------------------------------------------------------------

/**
 * Severity levels, ordered from most to least dangerous.
 *
 * critical — Irreversible system-level damage, zero tolerance
 * high     — Significant harm, hard to recover from
 * medium   — Notable risk, but recoverable
 * low      — Minor concern, informational
 */
export type Severity = "critical" | "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// The security system's decision
// ---------------------------------------------------------------------------

/** What to do about a detected threat. */
export type VerdictKind =
  | "deny"      // hard block — action is forbidden
  | "confirm"   // soft block — user must approve
  | "allow";    // explicit permit (logged but not blocked)

/**
 * A Verdict is the security system's answer to "is this action safe?"
 *
 * null return from evaluate() means "no policy matched — allow by default."
 * A Verdict always means a policy fired and has an opinion.
 */
export interface Verdict {
  /** The decision */
  kind: VerdictKind;
  /** Human-readable explanation of the risk (shown to user) */
  reason: string;
  /** What kind of harm was detected */
  threat: ThreatCategory;
  /** How bad is it */
  severity: Severity;
  /** Which policy triggered (stable identifier for audit/testing) */
  policyId: string;
}

// ---------------------------------------------------------------------------
// Security posture — the system's configuration
// ---------------------------------------------------------------------------

/**
 * Posture mode controls the overall restrictiveness.
 *
 * "lockdown"  — Read-only. No writes, no network.   (maps to sandbox read-only)
 * "standard"  — Workspace writes + localhost only.   (maps to sandbox workspace-write)
 * "permissive" — All writes, all network. Policies still enforce critical rules.
 *                                                     (maps to sandbox full-access)
 */
export type PostureMode = "lockdown" | "standard" | "permissive";

/** The current security configuration, queryable at any time. */
export interface SecurityPosture {
  mode: PostureMode;
  /** Current working directory (workspace root) */
  workspace: string;
  /** Network access allowed? */
  networkAllowed: boolean;
  /** How many policies are active */
  activePolicies: number;
  /** How many policies exist total */
  totalPolicies: number;
  /** Paths that are always protected from writes */
  protectedPaths: string[];
  /** Additional writable paths beyond workspace (standard mode) */
  additionalWritePaths: string[];
  /** OS-level enforcement available? */
  enforcementAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Policy summary — what callers can query
// ---------------------------------------------------------------------------

/** A read-only summary of a registered policy. */
export interface PolicySummary {
  id: string;
  description: string;
  threat: ThreatCategory;
  severity: Severity;
  verdict: VerdictKind;
  /** Whether this policy is active in the current posture */
  active: boolean;
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

/** A single audit record: what happened, when, and why. */
export interface AuditRecord {
  timestamp: number;
  /** The action that was evaluated */
  action: {
    tool: string;
    summary: string;          // truncated command or path
  };
  /** The policy that fired */
  policyId: string;
  /** What threat was detected */
  threat: ThreatCategory;
  severity: Severity;
  /** What decision was made */
  verdict: VerdictKind;
}

export interface AuditQuery {
  /** Filter by verdict kind */
  verdict?: VerdictKind;
  /** Filter by threat category */
  threat?: ThreatCategory;
  /** Filter by minimum severity */
  minSeverity?: Severity;
  /** Maximum records to return (default: 50) */
  limit?: number;
  /** Only records after this timestamp */
  since?: number;
}

export interface AuditSummary {
  total: number;
  denied: number;
  confirmed: number;
  allowed: number;
  /** Recent records (last 10) */
  recent: AuditRecord[];
}

// ---------------------------------------------------------------------------
// Verification evidence
// ---------------------------------------------------------------------------

/**
 * Evidence that work was verified before completion.
 * Tracked per-session. Policies like "unverified-completion" check this.
 */
export type EvidenceKind = "test" | "build" | "lint" | "typecheck" | "check";

// ---------------------------------------------------------------------------
// OS enforcement profile
// ---------------------------------------------------------------------------

/**
 * An opaque enforcement artifact.
 *
 * The caller never needs to know this is SBPL, seccomp, or anything else.
 * They just get: "here's a profile, here's how to launch with it."
 */
export interface EnforcementProfile {
  /** Whether OS-level enforcement is available on this platform */
  available: boolean;
  /** Path to the generated profile file */
  profilePath: string;
  /** Path to the launch script */
  launcherPath: string;
  /** Human-readable usage instructions */
  usage: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for the SafetyGate. No pi dependency. */
export interface SafetyConfig {
  /** Operating mode */
  mode: PostureMode;
  /** Workspace root (defaults to cwd) */
  workspace?: string;
  /** Allow outbound network access */
  networkAccess?: boolean;
  /** Additional writable paths beyond workspace */
  additionalWritePaths?: string[];
  /** Extra protected paths beyond the defaults */
  extraProtectedPaths?: string[];
  /** Max audit entries to retain */
  maxAuditEntries?: number;
  /** Directory for enforcement profile output */
  enforcementDir?: string;
}
```

---

## Part 2: SafetyGate API (`safety/gate.ts`)

```typescript
import type {
  Action,
  AuditQuery,
  AuditRecord,
  AuditSummary,
  EnforcementProfile,
  EvidenceKind,
  PolicySummary,
  SafetyConfig,
  SecurityPosture,
  Verdict,
} from "./types";

/**
 * SafetyGate — the unified security evaluation engine.
 *
 * Pure class. No dependency on pi runtime.
 * Testable: instantiate with a config, call evaluate(), assert verdicts.
 *
 * Usage:
 *   const gate = new SafetyGate({ mode: "standard" });
 *   const verdict = gate.evaluate({ tool: "bash", command: "rm -rf /", ... });
 *   if (verdict?.kind === "deny") { /* block it */ }
 */
export class SafetyGate {
  constructor(config: SafetyConfig);

  // =========================================================================
  // Core: "Is this action safe?"
  // =========================================================================

  /**
   * Evaluate an action against all active policies.
   *
   * Returns the highest-severity Verdict if any policy fires.
   * Returns null if no policy matches (action is allowed by default).
   *
   * Policies are evaluated in severity order (critical → low).
   * First match at the highest severity wins.
   */
  evaluate(action: Action): Verdict | null;

  // =========================================================================
  // Evidence tracking: "Has verification happened?"
  // =========================================================================

  /**
   * Record that a verification command ran in a session.
   * Called after test/build/lint/typecheck commands execute.
   */
  recordEvidence(sessionId: string, kind: EvidenceKind, detail: string): void;

  /**
   * Check if any verification evidence exists for a session.
   */
  hasEvidence(sessionId: string): boolean;

  // =========================================================================
  // Posture: "What's the security configuration?"
  // =========================================================================

  /** Get the current security posture. */
  getPosture(): SecurityPosture;

  // =========================================================================
  // Policies: "What rules are active?"
  // =========================================================================

  /** List all registered policies with their current active/inactive status. */
  listPolicies(): PolicySummary[];

  // =========================================================================
  // Audit: "What happened?"
  // =========================================================================

  /** Query the audit log. */
  getAuditLog(query?: AuditQuery): AuditRecord[];

  /** Get audit summary statistics. */
  getAuditSummary(): AuditSummary;

  // =========================================================================
  // Enforcement: "Generate OS-level protection"
  // =========================================================================

  /**
   * Generate and write an OS-level enforcement profile.
   *
   * On macOS: produces a Seatbelt profile + launch script.
   * On other platforms: returns { available: false }.
   *
   * Caller never sees the profile format — just gets paths and usage instructions.
   */
  generateEnforcementProfile(): EnforcementProfile;
}
```

---

## Part 3: Policy Registration (Internal — `safety/policies/`)

Callers never see this. This is how policies are implemented internally.

```typescript
// safety/policies/types.ts — INTERNAL, not part of public API

import type { Action, PostureMode, Severity, ThreatCategory, VerdictKind } from "../types";

/**
 * Internal policy definition.
 *
 * This is the IMPLEMENTATION layer that callers never touch.
 * Regex patterns, path matching, command parsing all live here.
 */
export interface PolicyDefinition {
  /** Stable identifier (e.g., "force-push-main") */
  id: string;
  /** Human-readable description */
  description: string;
  /** What threat category this detects */
  threat: ThreatCategory;
  /** Risk severity */
  severity: Severity;
  /** What to do when triggered */
  verdict: VerdictKind;
  /** Which posture modes this policy is active in (omit = always active) */
  activeModes?: PostureMode[];
  /** Test if this policy fires for a given action */
  match(action: Action, ctx: PolicyContext): boolean;
  /** Generate a human-readable risk explanation */
  explain(action: Action): string;
}

/**
 * Context provided to policies during matching.
 * Gives access to workspace info, evidence state, etc.
 */
export interface PolicyContext {
  workspace: string;
  mode: PostureMode;
  networkAllowed: boolean;
  protectedPaths: string[];
  additionalWritePaths: string[];
  hasVerificationEvidence(sessionId: string): boolean;
}
```

### Example Policy (Internal)

```typescript
// safety/policies/git.ts — INTERNAL

import type { PolicyDefinition } from "./types";

export const gitPolicies: PolicyDefinition[] = [
  {
    id: "force-push-main",
    description: "Force push to main/master branch",
    threat: "history-rewrite",
    severity: "critical",
    verdict: "deny",
    match(action) {
      if (action.tool !== "bash" || !action.command) return false;
      const cmd = action.command;
      const forceFlag =
        /git\s+push(?:\s+\S+)*?\s+(-f|--force)(?!-with-lease)/.test(cmd) &&
        /\b(main|master)\b/.test(cmd);
      const forceRefspec = /git\s+push\s+.*\+(main|master)\b/.test(cmd);
      return forceFlag || forceRefspec;
    },
    explain(action) {
      return `Force push to main/master is forbidden. Use --force-with-lease on feature branches instead.\n\nCommand: ${action.command?.slice(0, 100)}`;
    },
  },

  {
    id: "interactive-rebase",
    description: "Interactive rebase (history rewrite)",
    threat: "history-rewrite",
    severity: "medium",
    verdict: "confirm",
    match(action) {
      if (action.tool !== "bash" || !action.command) return false;
      return /\bgit\s+rebase\s+(-i|--interactive)\b/.test(action.command);
    },
    explain(action) {
      return `Interactive rebase rewrites git history. If this branch has been pushed, others may have based work on the existing history.\n\nCommand: ${action.command?.slice(0, 100)}`;
    },
  },

  // ... remaining git policies
];
```

---

## Part 4: Full Policy Mapping

### De-duplicated policy catalog (28 unique policies)

All existing rules from the three extensions, de-duplicated and mapped:

| # | Policy ID | Threat | Severity | Verdict | Source(s) | Notes |
|---|-----------|--------|----------|---------|-----------|-------|
| **Critical (deny)** |
| 1 | `force-push-main` | history-rewrite | critical | deny | guardrails | |
| 2 | `push-mirror` | data-destruction | critical | deny | guardrails | |
| 3 | `catastrophic-rm` | data-destruction | critical | deny | guardrails | |
| 4 | `credential-echo` | credential-exposure | critical | deny | guardrails | |
| 5 | `pipe-to-shell` | remote-code-execution | critical | deny | guardian | |
| 6 | `eval-remote` | remote-code-execution | critical | deny | guardian | |
| 7 | `sudo` | privilege-escalation | critical | deny | guardian | |
| 8 | `protected-path-write` | sensitive-modification | critical | deny | sandbox | |
| 9 | `protected-path-delete` | data-destruction | critical | deny | sandbox | |
| 10 | `workspace-escape` | workspace-escape | critical | deny | sandbox | `standard` mode only |
| 11 | `read-only-write` | workspace-escape | critical | deny | sandbox | `lockdown` mode only |
| **High (confirm)** |
| 12 | `git-reset-hard` | data-destruction | high | confirm | guardrails | |
| 13 | `git-checkout-dot` | data-destruction | high | confirm | guardrails | |
| 14 | `git-restore-dot` | data-destruction | high | confirm | guardrails | |
| 15 | `git-clean` | data-destruction | high | confirm | guardrails | |
| 16 | `bulk-delete-src` | data-destruction | high | confirm | guardian | ★ subsumes sandbox `destructive-operation` for rm -rf |
| 17 | `database-drop` | data-destruction | high | confirm | guardian | |
| 18 | `kill-process` | data-destruction | high | confirm | guardian | |
| 19 | `npm-publish` | registry-publish | high | confirm | guardian | ★ subsumes sandbox network block for publish |
| 20 | `cargo-publish` | registry-publish | high | confirm | guardian | ★ subsumes sandbox network block for publish |
| 21 | `docker-prune` | data-destruction | high | confirm | guardian | |
| **Medium (confirm)** |
| 22 | `git-add-all` | sensitive-modification | medium | confirm | guardrails | |
| 23 | `env-write` | credential-exposure | medium | confirm | guardrails | |
| 24 | `bypass-hooks` | history-rewrite | medium | confirm | guardrails | |
| 25 | `sensitive-file-write` | credential-exposure | medium | confirm | guardrails + sandbox | ★ merged: guardrails `.env/.ssh` + sandbox protected warn |
| 26 | `unverified-completion` | unverified-completion | medium | confirm | guardrails | requires evidence tracking |
| 27 | `dangerous-permissions` | privilege-escalation | medium | confirm | guardian + sandbox | ★ merged: chmod 777/setuid |
| 28 | `shell-profile-mutation` | sensitive-modification | medium | confirm | guardian | |
| 29 | `interactive-rebase` | history-rewrite | medium | confirm | guardian | |
| 30 | `branch-delete` | data-destruction | medium | confirm | guardian | |
| 31 | `stash-drop` | data-destruction | medium | confirm | guardian | |
| 32 | `network-access` | network-exfiltration | medium | confirm | sandbox | `standard` mode, with allowlist |
| 33 | `destructive-bulk` | data-destruction | medium | confirm | sandbox | find -delete, dd, mkfs, chown |

### Overlaps resolved

| Overlap | guardrails | guardian | sandbox | Unified resolution |
|---------|-----------|----------|---------|-------------------|
| `rm -rf` | `catastrophic-rm` (block root/home) | `bulk-delete-src` (confirm src dirs) | `destructive-operation` (confirm any rm -rf) | **Three policies**, ordered by severity: catastrophic-rm (critical) → bulk-delete-src (high) → destructive-bulk (medium). First match at highest severity wins. |
| `chmod 777` | — | `chmod-dangerous` (medium) | destructive pattern (medium) | **Merged** into `dangerous-permissions` (medium confirm) |
| `npm publish` | — | `npm-publish` (high) | network-denied (medium) | **`npm-publish` wins** (higher severity, more specific). Network policy skips if publish policy already matched. |
| `.env` write | `env-write` (warn bash >>) | — | delete-protected-warn (.env delete) | **Two policies**: `env-write` (bash redirects), `sensitive-file-write` (write/edit tool). Different signals, both needed. |

---

## Part 5: Pi Extension Adapter (`safety/adapter.ts`)

This is the ONLY file that knows about pi. ~80 LOC.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { SafetyGate } from "./gate";
import type { Action, EvidenceKind, PostureMode, Verdict } from "./types";

// ---------------------------------------------------------------------------
// Configuration loading
// ---------------------------------------------------------------------------

function loadConfig(): import("./types").SafetyConfig {
  const modeEnv = process.env.PI_SANDBOX_MODE ?? "workspace-write";
  const modeMap: Record<string, PostureMode> = {
    "read-only": "lockdown",
    "workspace-write": "standard",
    "full-access": "permissive",
  };
  return {
    mode: modeMap[modeEnv] ?? "standard",
    workspace: process.cwd(),
    networkAccess: process.env.PI_SANDBOX_NETWORK === "true",
    enforcementDir: ".pi/sandbox",
  };
}

// ---------------------------------------------------------------------------
// Event → Action translation
// ---------------------------------------------------------------------------

function eventToAction(event: any): Action | null {
  const tool = event?.name ?? event?.toolName;
  if (!tool || typeof tool !== "string") return null;

  const params = event?.input ?? event?.params ?? {};
  const sessionId = event?.sessionId ?? "default";

  if (tool === "bash") {
    const command = params?.command;
    if (!command || typeof command !== "string") return null;
    return { tool, command: command.replace(/\s+/g, " ").trim(), params, sessionId };
  }

  if (tool === "write" || tool === "edit") {
    const path = params?.path;
    if (!path || typeof path !== "string") return null;
    return { tool, path, params, sessionId };
  }

  if (tool.toLowerCase() === "taskupdate" || tool.toLowerCase() === "task_update") {
    return { tool: "TaskUpdate", params, sessionId };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Verdict → pi response translation
// ---------------------------------------------------------------------------

function verdictToResponse(verdict: Verdict): { blocked: true; message: string } | { confirm: true; message: string } | undefined {
  if (verdict.kind === "deny") {
    return {
      blocked: true,
      message: `[safety] BLOCKED (${verdict.severity}): ${verdict.reason}\n\nThreat: ${verdict.threat}\nPolicy: ${verdict.policyId}`,
    };
  }
  if (verdict.kind === "confirm") {
    return {
      confirm: true,
      message: `[safety] ${verdict.severity === "high" ? "HIGH RISK" : "WARNING"}: ${verdict.reason}\n\nProceed?`,
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Evidence classification
// ---------------------------------------------------------------------------

const EVIDENCE_PATTERNS: Array<{ kind: EvidenceKind; pattern: RegExp }> = [
  { kind: "test",      pattern: /\b(npm|pnpm|yarn|bun)\s+test\b/i },
  { kind: "test",      pattern: /\b(vitest|jest|pytest|cargo\s+test|go\s+test)\b/i },
  { kind: "build",     pattern: /\b(npm|pnpm|yarn|bun)\s+run\s+\S*build\S*/i },
  { kind: "build",     pattern: /\bcargo\s+build\b/i },
  { kind: "lint",      pattern: /\b(eslint|ruff\s+check|cargo\s+clippy|golangci-lint)\b/i },
  { kind: "typecheck", pattern: /\b(tsc|mypy|pyright|cargo\s+check|go\s+vet)\b/i },
];

function classifyEvidence(command: string): EvidenceKind | null {
  for (const { kind, pattern } of EVIDENCE_PATTERNS) {
    if (pattern.test(command)) return kind;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function safetyExtension(pi: ExtensionAPI): void {
  const gate = new SafetyGate(loadConfig());

  // Generate enforcement profile on startup
  gate.generateEnforcementProfile();

  // --- Intercept all tool calls ---
  pi.on("before_tool_call", (event: any) => {
    const action = eventToAction(event);
    if (!action) return;

    const verdict = gate.evaluate(action);
    if (!verdict) return;

    return verdictToResponse(verdict);
  });

  // --- Track verification evidence ---
  pi.on("tool_result", (event: any) => {
    const toolName = event?.name ?? event?.toolName;
    if (toolName !== "bash") return;

    const command = event?.input?.command ?? event?.params?.command ?? "";
    if (!command || typeof command !== "string") return;

    const kind = classifyEvidence(command);
    if (kind) {
      const sessionId = event?.sessionId ?? "default";
      gate.recordEvidence(sessionId, kind, command.slice(0, 200));
    }
  });

  // --- Unified /safety command ---
  pi.registerCommand("safety", {
    description: "Show security posture, active policies, and audit log",
    async handler(_args: any, ctx: any) {
      const posture = gate.getPosture();
      const policies = gate.listPolicies();
      const audit = gate.getAuditSummary();

      const activePolicies = policies.filter(p => p.active);
      const bySeverity = (s: string) => activePolicies.filter(p => p.severity === s).length;

      const lines = [
        "## Security Posture\n",
        `**Mode**: ${posture.mode}`,
        `**Workspace**: ${posture.workspace}`,
        `**Network**: ${posture.networkAllowed ? "allowed" : "denied"}`,
        `**OS enforcement**: ${posture.enforcementAvailable ? "active" : "unavailable"}`,
        "",
        `**Active policies**: ${posture.activePolicies} / ${posture.totalPolicies}`,
        `  Critical: ${bySeverity("critical")}  High: ${bySeverity("high")}  Medium: ${bySeverity("medium")}`,
        "",
        `**Audit log**: ${audit.total} events`,
        `  Denied: ${audit.denied}  Confirmed: ${audit.confirmed}  Allowed: ${audit.allowed}`,
      ];

      if (audit.recent.length > 0) {
        lines.push("", "### Recent Events");
        for (const r of audit.recent.slice(-5)) {
          const time = new Date(r.timestamp).toLocaleTimeString();
          const icon = r.verdict === "deny" ? "✗" : r.verdict === "confirm" ? "?" : "✓";
          lines.push(`  ${time} ${icon} [${r.policyId}] ${r.action.summary.slice(0, 60)}`);
        }
      }

      lines.push("", "### Active Policies");
      for (const p of activePolicies) {
        lines.push(`  [${p.severity.toUpperCase().padEnd(8)}] ${p.id}: ${p.description}`);
      }

      const output = lines.join("\n").trim();
      if (ctx?.ui) ctx.ui.notify(output, "info");
      return output;
    },
  });
}
```

---

## Part 6: Domain Concept Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CALLER'S WORLD                               │
│                                                                     │
│   "Is this safe?"        → gate.evaluate(action)    → Verdict|null  │
│   "What could go wrong?" → verdict.threat           → ThreatCategory│
│   "How bad is it?"       → verdict.severity         → Severity      │
│   "What rules exist?"    → gate.listPolicies()      → PolicySummary │
│   "What mode am I in?"   → gate.getPosture()        → SecurityPosture│
│   "What happened?"       → gate.getAuditLog()       → AuditRecord[] │
│   "Protect the OS"       → gate.generateEnforcement  → Profile paths│
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                    ADAPTER LAYER (~80 LOC)                           │
│                                                                     │
│   pi event  →  eventToAction()  →  Action                           │
│   Verdict   →  verdictToResponse()  →  { blocked/confirm }          │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                 IMPLEMENTATION (callers never see)                   │
│                                                                     │
│   PolicyDefinition[]   — regex matchers, path checks               │
│   SBPL generation      — macOS seatbelt profiles                   │
│   Network allowlists   — curl/wget/npm pattern matching            │
│   Path normalization   — symlink resolution, ~ expansion           │
│   Command parsing      — extractWriteTargets, splitSubCommands     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Part 7: Testing Without Pi

```typescript
// safety/__tests__/gate.test.ts

import { SafetyGate } from "../gate";

describe("SafetyGate", () => {
  const gate = new SafetyGate({ mode: "standard", workspace: "/tmp/test-project" });

  test("blocks force push to main", () => {
    const verdict = gate.evaluate({
      tool: "bash",
      command: "git push origin main --force",
      params: { command: "git push origin main --force" },
      sessionId: "test",
    });

    expect(verdict).not.toBeNull();
    expect(verdict!.kind).toBe("deny");
    expect(verdict!.threat).toBe("history-rewrite");
    expect(verdict!.severity).toBe("critical");
  });

  test("confirms rm -rf src/", () => {
    const verdict = gate.evaluate({
      tool: "bash",
      command: "rm -rf src/",
      params: { command: "rm -rf src/" },
      sessionId: "test",
    });

    expect(verdict).not.toBeNull();
    expect(verdict!.kind).toBe("confirm");
    expect(verdict!.threat).toBe("data-destruction");
  });

  test("allows normal git commit", () => {
    const verdict = gate.evaluate({
      tool: "bash",
      command: "git commit -m 'feat: add login'",
      params: { command: "git commit -m 'feat: add login'" },
      sessionId: "test",
    });

    expect(verdict).toBeNull(); // no policy fires
  });

  test("blocks write outside workspace in standard mode", () => {
    const verdict = gate.evaluate({
      tool: "write",
      path: "/etc/hosts",
      params: { path: "/etc/hosts", content: "..." },
      sessionId: "test",
    });

    expect(verdict!.kind).toBe("deny");
    expect(verdict!.threat).toBe("sensitive-modification");
  });

  test("confirms task completion without evidence", () => {
    const verdict = gate.evaluate({
      tool: "TaskUpdate",
      params: { taskId: "1", status: "completed" },
      sessionId: "no-evidence-session",
    });

    expect(verdict!.kind).toBe("confirm");
    expect(verdict!.threat).toBe("unverified-completion");
  });

  test("allows task completion with evidence", () => {
    gate.recordEvidence("verified-session", "test", "npm test");

    const verdict = gate.evaluate({
      tool: "TaskUpdate",
      params: { taskId: "1", status: "completed" },
      sessionId: "verified-session",
    });

    expect(verdict).toBeNull(); // evidence exists, allowed
  });

  test("lockdown mode blocks all writes", () => {
    const lockdown = new SafetyGate({ mode: "lockdown", workspace: "/tmp/test" });

    const verdict = lockdown.evaluate({
      tool: "write",
      path: "/tmp/test/src/foo.ts",
      params: { path: "/tmp/test/src/foo.ts" },
      sessionId: "test",
    });

    expect(verdict!.kind).toBe("deny");
    expect(verdict!.threat).toBe("workspace-escape");
  });

  test("posture reports active policies", () => {
    const posture = gate.getPosture();
    expect(posture.mode).toBe("standard");
    expect(posture.activePolicies).toBeGreaterThan(25);
  });

  test("listPolicies returns all with active status", () => {
    const policies = gate.listPolicies();
    const critical = policies.filter(p => p.severity === "critical" && p.active);
    expect(critical.length).toBeGreaterThanOrEqual(8);
  });

  test("audit log records evaluations", () => {
    const fresh = new SafetyGate({ mode: "standard", workspace: "/tmp/test" });
    fresh.evaluate({
      tool: "bash",
      command: "sudo rm -rf /",
      params: { command: "sudo rm -rf /" },
      sessionId: "test",
    });

    const log = fresh.getAuditLog();
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0].verdict).toBe("deny");
  });
});
```

---

## Part 8: File Structure

```
.pi/extensions/
  safety/
    types.ts              # Domain types (Action, Verdict, Threat, etc.)  ~120 LOC
    gate.ts               # SafetyGate class                             ~200 LOC
    adapter.ts            # Pi extension adapter (thin)                  ~120 LOC
    index.ts              # Re-export: export { default } from "./adapter"  ~1 LOC
    enforcement.ts        # OS profile generation (SBPL internals)       ~120 LOC
    evidence.ts           # Verification evidence tracking               ~60 LOC
    audit.ts              # Unified audit log                            ~80 LOC
    policies/
      index.ts            # Registry: collect + export all policies      ~30 LOC
      git.ts              # 8 policies (force-push, reset, clean, etc.)  ~120 LOC
      filesystem.ts       # 4 policies (protected paths, workspace)      ~150 LOC
      execution.ts        # 3 policies (RCE, sudo, pipe-to-shell)       ~60 LOC
      data.ts             # 7 policies (rm, drop, prune, bulk delete)    ~120 LOC
      network.ts          # 2 policies (network access, publish)         ~100 LOC
      credentials.ts      # 3 policies (echo, env write, sensitive file) ~80 LOC
      workflow.ts          # 1 policy (unverified completion)            ~40 LOC
    helpers/
      paths.ts            # Path normalization, protection checks        ~80 LOC
      commands.ts         # Command parsing, target extraction           ~100 LOC
    __tests__/
      gate.test.ts        # Core gate tests                              ~150 LOC
      policies.test.ts    # Individual policy tests                      ~300 LOC

Total: ~1,900 LOC (vs current 1,650 LOC across 3 files)
  — Net increase: ~250 LOC, all in tests and type definitions
  — Production code: ~1,300 LOC (vs 1,650) — 20% reduction through de-duplication
```

---

## Part 9: Migration Plan

### Phase 1: Build the new module (no breakage)

1. Create `safety/types.ts` — all domain types
2. Port `safety/helpers/paths.ts` from sandbox.ts path utilities
3. Port `safety/helpers/commands.ts` from sandbox.ts command parsing
4. Create `safety/policies/*.ts` — port all rules from the three extensions
5. Create `safety/enforcement.ts` — port SBPL generation from sandbox.ts
6. Create `safety/evidence.ts` — port verification tracking from guardrails.ts
7. Create `safety/audit.ts` — unified audit log
8. Create `safety/gate.ts` — SafetyGate class wiring policies + audit + evidence
9. Create `safety/adapter.ts` — pi extension adapter
10. Create `safety/__tests__/` — comprehensive tests

**Verification**: `npm test safety/` passes, all 33 policies have test coverage.

### Phase 2: Swap in (single commit)

1. Update `.pi/settings.json` extensions to include `safety/` instead of the three files
2. Remove `guardrails.ts`, `guardian.ts`, `sandbox.ts` from extensions
3. Verify `/safety` command works (replaces `/guardrails`, `/guardian`, `/sandbox`)

**Verification**: Run `npm test`, manually test a few blocked commands.

### Phase 3: Cleanup

1. Remove old files
2. Update any documentation referencing the old extensions
3. Update memory observations about the old structure

### Effort Estimate

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1: Build new module | 3-4 hours | Low — additive, no breakage |
| Phase 2: Swap in | 30 min | Medium — one-shot switch |
| Phase 3: Cleanup | 30 min | Low — removing dead code |
| **Total** | **~4-5 hours** | |

### Risk Mitigations

- **Regression**: Every existing rule has a named test case in the new suite
- **Ordering**: `evaluate()` sorts policies by severity (critical first), eliminating implicit load-order dependencies
- **Overlap**: De-duplication table (Part 4) documents exactly which old rules merged
- **Rollback**: Old files exist in git history; swap back by reverting Phase 2 commit

---

## Verification

The plan succeeds when:

1. `gate.evaluate()` produces identical block/confirm decisions for all commands the old extensions handled
2. `gate.listPolicies()` returns 33 policies with correct threat/severity/verdict
3. `gate.getPosture()` correctly reports mode, workspace, network, protected paths
4. `gate.getAuditLog()` shows unified trail (not three separate logs)
5. `gate.generateEnforcementProfile()` writes `.pi/sandbox/profile.sb` and `launch.sh`
6. All tests pass without importing any pi runtime modules
7. `/safety` command in pi shows combined status of all former `/guardrails`, `/guardian`, `/sandbox`

## Next Action

Implement Phase 1, starting with `safety/types.ts` and `safety/helpers/`.
