/**
 * Diagnostics Extension — Code Diagnostics & Auto-Feedback
 *
 * Two channels:
 *   1. Explicit `diagnostics` tool — agent calls for project-wide checks
 *      Includes Fallow static analysis (dead code, complexity) for TS/JS projects
 *      and aislop (AI slop detection) for all supported languages.
 *   2. Auto-inject after write/edit — diagnostics appended to tool results
 *
 * Multi-language support: auto-detects project languages by known markers
 * and runs the appropriate CLI diagnostic tools.
 *
 * | Language  | Marker file(s)          | Diagnostic tool                    |
 * |-----------|-------------------------|------------------------------------|
 * | TypeScript| tsconfig.json           | tsc --noEmit + Fallow (explicit)   |
 * | Rust      | Cargo.toml              | cargo check                        |
 * | Go        | go.mod                  | go vet ./...                       |
 * | Python    | pyproject.toml,setup.py | ruff → mypy (first found)          |
 *
 * Opt-out: PI_DISABLE_AUTO_DIAGNOSTICS=true
 * Timeout:  PI_DIAGNOSTICS_TIMEOUT_MS (default 30000)
 *
 * Design: CLI-based (no LSP servers). Inspired by OpenCode's diagnostic model
 * but avoids the complexity of spawning ~35 language server processes.
 * See https://opencode.ai/docs/lsp/ for the reference design.
 *
 * Fallow: https://fallow.tools — deterministic static analysis for TS/JS.
 * Provides dead code detection, complexity scoring, and health auditing.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiagnosticRunner {
  /** Short id, e.g. "typescript", "rust" */
  name: string;
  /** Human label, e.g. "TypeScript (tsc)" */
  label: string;
  /** File extensions that this runner handles for auto-injection. */
  extensions: string[];
  /**
   * Check if this language is used in the project root.
   * Looks for known marker files.
   */
  detect(root: string): boolean;
  /**
   * Resolve the diagnostic command for this project.
   * Returns null if the tool is not available.
   */
  resolve(root: string): { bin: string; args: string[] } | null;
}

// ---------------------------------------------------------------------------
// Language definitions
// ---------------------------------------------------------------------------

/**
 * Resolve a binary from multiple possible paths.
 * Tries each candidate bin path; returns the first that exists.
 */
function findBin(candidates: string[]): string | undefined {
  for (const bin of candidates) {
    if (bin && fs.existsSync(bin)) return bin;
  }
  return undefined;
}

function nodeBin(root: string, name: string): string {
  return path.join(root, "node_modules", ".bin", name);
}

function pathWhich(bin: string): string | undefined {
  const pathDirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, bin);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const LANG_DIAGNOSTICS: DiagnosticRunner[] = [
  // ---- TypeScript ---------------------------------------------------------
  {
    name: "typescript",
    label: "TypeScript (tsc)",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"],
    detect(root) {
      return fs.existsSync(path.join(root, "tsconfig.json"));
    },
    resolve(root) {
      const localTsc = nodeBin(root, process.platform === "win32" ? "tsc.cmd" : "tsc");
      if (fs.existsSync(localTsc)) {
        return { bin: localTsc, args: ["--noEmit", "--pretty", "false"] };
      }
      return { bin: "npx", args: ["--yes", "tsc", "--noEmit", "--pretty", "false"] };
    },
  },

  // ---- Rust ---------------------------------------------------------------
  {
    name: "rust",
    label: "Rust (cargo check)",
    extensions: [".rs"],
    detect(root) {
      return fs.existsSync(path.join(root, "Cargo.toml"));
    },
    resolve(_root) {
      const cargo = pathWhich("cargo");
      if (!cargo) return null;
      return { bin: cargo, args: ["check", "--quiet"] };
    },
  },

  // ---- Go -----------------------------------------------------------------
  {
    name: "go",
    label: "Go (go vet)",
    extensions: [".go"],
    detect(root) {
      return fs.existsSync(path.join(root, "go.mod"));
    },
    resolve(_root) {
      const govet = pathWhich("go");
      if (!govet) return null;
      return { bin: govet, args: ["vet", "./..."] };
    },
  },

  // ---- Python -------------------------------------------------------------
  {
    name: "python",
    label: "Python (ruff → mypy)",
    extensions: [".py", ".pyi"],
    detect(root) {
      return (
        fs.existsSync(path.join(root, "pyproject.toml")) ||
        fs.existsSync(path.join(root, "setup.py")) ||
        fs.existsSync(path.join(root, "setup.cfg")) ||
        fs.existsSync(path.join(root, "requirements.txt")) ||
        fs.existsSync(path.join(root, "Pipfile"))
      );
    },
    resolve(_root) {
      // Prefer ruff (fast), fall back to mypy (deeper checking)
      const ruff = pathWhich("ruff");
      if (ruff) return { bin: ruff, args: ["check", "."] };

      const mypy = pathWhich("mypy");
      if (mypy) return { bin: mypy, args: ["."] };

      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map file extension → matching diagnostic runners. Built once. */
const EXT_TO_RUNNERS = new Map<string, DiagnosticRunner[]>();
for (const runner of LANG_DIAGNOSTICS) {
  for (const ext of runner.extensions) {
    const list = EXT_TO_RUNNERS.get(ext) || [];
    list.push(runner);
    EXT_TO_RUNNERS.set(ext, list);
  }
}

const CONFIG_FILES = new Set([
  "package.json", "tsconfig.json", "jsconfig.json",
  ".eslintrc", ".eslintrc.json", ".eslintrc.js",
  ".prettierrc",
  "bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock", "package-lock.json",
  "Cargo.toml", "Cargo.lock",
  "go.mod", "go.sum",
  "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile",
]);

// ---- Fallow (TS/JS quality analysis) -------------------------------------

interface FallowSummary {
  health?: string;       // Formatted health warnings
  deadCode?: string;     // Formatted dead code findings
}

/**
 * Run Fallow analysis for TS/JS projects.
 * Only runs in the explicit `diagnostics` tool (not auto-injection).
 * Runs health + dead-code checks and returns a formatted block.
 */
async function runFallowAnalysis(root: string): Promise<string> {
  // Only applicable to TS/JS projects
  if (!fs.existsSync(path.join(root, "tsconfig.json"))) return "";

  const npxBin = pathWhich("npx");
  if (!npxBin) return "";

  const fallowTimeout = parseInt(
    process.env.PI_DIAGNOSTICS_TIMEOUT_MS || "60000",
    10,
  );

  const summary: FallowSummary = {};

  // -- health: complexity, scores, refactor targets --
  const healthRaw = await runCLI(npxBin, ["--yes", "fallow", "health", "--format", "json"], root, fallowTimeout);
  if (healthRaw) {
    summary.health = formatFallowHealth(healthRaw);
  }

  // -- dead-code: unused exports, files, dependencies --
  if (!summary.health?.includes("No issues found")) {
    // Only run dead-code if health didn't error out
    const deadRaw = await runCLI(npxBin, ["--yes", "fallow", "dead-code", "--format", "json"], root, fallowTimeout);
    if (deadRaw) {
      summary.deadCode = formatFallowDeadCode(deadRaw);
    }
  }

  const parts = [summary.health, summary.deadCode].filter(Boolean) as string[];
  if (parts.length === 0) return "";

  return buildBlock("Fallow (code quality)", [
    ...parts,
    `\n  Tip: run \`npx fallow\` directly for the full suite, or use the Fallow MCP.`,
  ]);
}

/**
 * Run a CLI command and return stdout, or empty string on failure.
 */
function runCLI(
  bin: string, args: string[], cwd: string, timeout: number,
): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      bin, args,
      { cwd, timeout, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, PATH: process.env.PATH || "" } },
      (error, stdout, _stderr) => {
        if (error) { resolve(""); return; }
        const out = (stdout || "").trim();
        resolve(out || "");
      },
    );
  });
}

function formatFallowHealth(raw: string): string {
  try {
    const data = JSON.parse(raw);
    const lines: string[] = [];

    // Large functions
    const largeFns = data.largeFunctions || [];
    if (largeFns.length > 0) {
      lines.push(`${largeFns.length} large function(s):`);
      for (const fn of largeFns.slice(0, 10)) {
        const loc = `${fn.file || "?"}:${fn.line || "?"}`;
        lines.push(`  - ${fn.name || "anonymous"} (${loc}) — ${fn.lines || "?"} lines`);
      }
      if (largeFns.length > 10) lines.push(`  ... and ${largeFns.length - 10} more`);
    }

    // High complexity functions
    const complex = data.highComplexityFunctions || [];
    if (complex.length > 0) {
      lines.push(`${complex.length} high-complexity function(s):`);
      for (const fn of complex.slice(0, 10)) {
        const loc = `${fn.file || "?"}:${fn.line || "?"}`;
        lines.push(`  - ${fn.name || "anonymous"} (${loc}) — ${fn.severity || ""}`.trim());
      }
      if (complex.length > 10) lines.push(`  ... and ${complex.length - 10} more`);
    }

    // File health scores (show bottom 5 — the worst offenders)
    const files = data.fileHealthScores || [];
    if (files.length > 0) {
      const worst = [...files].sort((a: any, b: any) => (a.score || 0) - (b.score || 0)).slice(0, 5);
      lines.push(`Health scores (worst 5 of ${files.length} files):`);
      for (const f of worst) {
        const pct = f.deadPercentage !== undefined ? `, ${f.deadPercentage}% dead` : "";
        lines.push(`  ${f.score?.toFixed(1) || "?"}  ${f.file || "?"} (${f.loc || "?"} LOC${pct})`);
      }
    }

    // Refactoring targets
    const refactors = data.refactoringTargets || [];
    if (refactors.length > 0) {
      lines.push(`${refactors.length} refactoring target(s):`);
      for (const r of refactors.slice(0, 5)) {
        const reason = r.reason || r.issue || "";
        const effort = r.effort ? ` [effort: ${r.effort}]` : "";
        lines.push(`  priority ${r.priority || "?"}  ${r.file || "?"}${effort}${reason ? ` — ${reason}` : ""}`);
      }
    }

    if (lines.length === 0) return "✅ No quality issues found";
    return lines.join("\n");
  } catch {
    // If JSON parsing fails, return raw truncated output
    const truncated = raw.split("\n").slice(0, 15).join("\n");
    return truncated || "";
  }
}

function formatFallowDeadCode(raw: string): string {
  try {
    const data = JSON.parse(raw);
    const lines: string[] = [];

    const unusedFiles = data.unusedFiles || [];
    if (unusedFiles.length > 0) {
      lines.push(`${unusedFiles.length} unused file(s):`);
      for (const f of unusedFiles.slice(0, 10)) {
        lines.push(`  - ${f.file || f.path || f}`);
      }
      if (unusedFiles.length > 10) lines.push(`  ... and ${unusedFiles.length - 10} more`);
    }

    const unusedExports = data.unusedExports || data.unusedExportsAndTypes || [];
    if (unusedExports.length > 0) {
      lines.push(`${unusedExports.length} unused export(s):`);
      for (const e of unusedExports.slice(0, 10)) {
        lines.push(`  - ${e.exportName || e.name || e.symbol || "?"} in ${e.file || "?"}`);
      }
      if (unusedExports.length > 10) lines.push(`  ... and ${unusedExports.length - 10} more`);
    }

    const circular = data.circularDependencies || [];
    if (circular.length > 0) {
      lines.push(`${circular.length} circular dependenc(y|ies):`);
      for (const c of circular.slice(0, 5)) {
        const chain = Array.isArray(c) ? c.join(" → ") : (c.chain || c.files?.join(" → ") || String(c));
        lines.push(`  ${chain}`);
      }
    }

    if (lines.length === 0) return "✅ No dead code found";
    return lines.join("\n");
  } catch {
    return "";
  }
}

// ---- aislop (AI slop detection) ------------------------------------------

/**
 * Run aislop scan on the project and return formatted output.
 * Detects: narrative comments, swallowed exceptions, console.log, as any, thin wrappers, etc.
 */
async function runAislopAnalysis(root: string): Promise<string> {
  // Check if aislop is available
  const aislopBin = pathWhich("aislop") || pathWhich("npx");
  if (!aislopBin) return "";

  const args = aislopBin.endsWith("npx")
    ? ["--yes", "aislop@latest", "scan", "--json"]
    : ["scan", "--json"];

  const raw = await runCLI(aislopBin, args, root, 30000);
  if (!raw) return "";

  try {
    const data = raw.startsWith("{") ? JSON.parse(raw) : null;
    if (!data) return "";

    if (!data.scoreable) return "";

    const lines: string[] = [];

    // Score
    const color = data.score >= 80 ? "✅" : data.score >= 50 ? "⚠️" : "❌";
    lines.push(`${color} Slop score: ${data.score}/100`);

    // Summary counts
    const summary = data.summary || {};
    const errCount = summary.errors || 0;
    const warnCount = summary.warnings || 0;
    if (errCount > 0 || warnCount > 0) {
      const parts: string[] = [];
      if (errCount > 0) parts.push(`${errCount} errors`);
      if (warnCount > 0) parts.push(`${warnCount} warnings`);
      lines.push(`Findings: ${parts.join(", ")}`);
    }

    // Group diagnostics by engine
    const diagnostics = data.diagnostics || [];
    const byEngine = new Map<string, typeof diagnostics>();
    for (const d of diagnostics) {
      const engine = d.engine || "unknown";
      if (!byEngine.has(engine)) byEngine.set(engine, []);
      byEngine.get(engine)!.push(d);
    }

    for (const [engine, diags] of byEngine) {
      const label = (data.engineDefinitions?.[engine]?.label || engine).padEnd(14);
      lines.push(`  ${label}  ${diags.length} finding(s)`);

      for (const d of diags.slice(0, 5)) {
        const tag = d.severity === "error" ? "[ERR]" : d.severity === "warning" ? "[WARN]" : "[INFO]";
        const loc = d.filePath ? `${d.filePath}${d.line ? `:${d.line}` : ""}` : "";
        lines.push(`    ${tag} ${(d.message || "").slice(0, 100)}${loc ? ` (${loc})` : ""}`);
      }
      if (diags.length > 5) lines.push(`    ... and ${diags.length - 5} more`);
    }

    if (lines.length <= 1) return "✅ aislop: No issues found";
    return lines.join("\n");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

const DIAGNOSTICS_TIMEOUT_MS = parseInt(
  process.env.PI_DIAGNOSTICS_TIMEOUT_MS || "30000",
  10,
);

function buildBlock(toolLabel: string, lines: string[]): string {
  return [
    `<diagnostics tool="${toolLabel}">`,
    ...lines.flatMap((s) => s.split("\n").map((l) => `  ${l}`)),
    "</diagnostics>",
  ].join("\n");
}

/**
 * Run a single diagnostic runner. Returns structured output or empty string.
 */
function runOne(runner: DiagnosticRunner, root: string): Promise<string> {
  const cmd = runner.resolve(root);
  if (!cmd) return Promise.resolve("");

  return new Promise<string>((resolve) => {
    execFile(
      cmd.bin,
      cmd.args,
      {
        cwd: root,
        timeout: DIAGNOSTICS_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, PATH: process.env.PATH || "" },
      },
      (error, stdout, stderr) => {
        // Most diagnostic tools report errors on stderr (rustc, go, mypy)
        // or stdout with --pretty false (tsc). Capture both.
        const output = (stderr || stdout || "").trim();

        // ENOENT means tool not installed — silently skip
        if (!output && (!error || (error as NodeJS.ErrnoException).code === "ENOENT")) {
          resolve("");
          return;
        }

        const lines = output.split("\n").filter(Boolean);
        if (lines.length === 0) { resolve(""); return; }

        // Keep raw output for the agent but tag with the runner label
        const tag = runner.label;
        const block = [
          `<diagnostics tool="${tag}">`,
          ...lines.map((l) => `  ${l}`),
          "</diagnostics>",
        ].join("\n");

        resolve(block);
      },
    );
  });
}

/**
 * Run all diagnostics that match the project.
 */
async function runAll(root: string): Promise<string[]> {
  const jobs = LANG_DIAGNOSTICS
    .filter((r) => r.detect(root))
    .map((r) => runOne(r, root));

  if (jobs.length === 0) return [];

  const results = await Promise.all(jobs);
  return results.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Auto-injection caching / debounce
// ---------------------------------------------------------------------------

let lastRunTimestamp = 0;
const DEBOUNCE_MS = 15_000; // Project-wide debounce

function shouldSkipAuto(filePath: string): boolean {
  if (process.env.PI_DISABLE_AUTO_DIAGNOSTICS === "true") return true;

  const basename = path.basename(filePath);
  if (CONFIG_FILES.has(basename)) return true;

  // Project-wide debounce — any write/edit within 15s skips re-run
  const now = Date.now();
  if (now - lastRunTimestamp < DEBOUNCE_MS) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function diagnosticsExtension(pi: ExtensionAPI): void {
  // ===============================================================
  // 1. Explicit diagnostics tool — on-demand project-wide check
  // ===============================================================
  pi.registerTool({
    name: "diagnostics",
    label: "Diagnostics",
    description:
      "Run code diagnostics on the current project. " +
      "Auto-detects supported languages in the project and runs the appropriate " +
      "diagnostic tools (type checking, static analysis, linting).\n\n" +
      "For TypeScript/JavaScript projects, also runs Fallow static analysis to " +
      "detect dead code, complexity hotspots, and code quality issues.\n" +
      "For all supported languages, runs aislop to detect AI slop patterns " +
      "(narrative comments, swallowed exceptions, console.log, as any, etc.).\n\n" +
      "Supported languages and tools:\n" +
      LANG_DIAGNOSTICS.map(
        (r) => `  - ${r.label} (markers: ${r.extensions.join(", ")})`,
      ).join("\n") +
      "  - Fallow (code quality) — TS/JS projects only (auto-detected)\n" +
      "\nShows errors, warnings, and hints to help catch issues before they reach production.",
    promptSnippet: "Run diagnostics to find errors, warnings, complexity issues, dead code, and type issues across all project languages",
    parameters: Type.Object({}),
    async execute(
      _toolCallId: string,
      _params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: undefined,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<Record<string, unknown>>> {
      // Run language diagnostics (tsc, cargo check, go vet, etc.)
      const diagBlocks = await runAll(ctx.cwd);

      // Run Fallow analysis for TS/JS projects
      const fallowBlock = await runFallowAnalysis(ctx.cwd);

      // Run aislop analysis for slop detection (multi-language)
      const aislopBlock = await runAislopAnalysis(ctx.cwd);

      const allBlocks = [...diagBlocks];
      if (fallowBlock) allBlocks.push(fallowBlock);
      if (aislopBlock) allBlocks.push(aislopBlock);

      if (allBlocks.length === 0) {
        // Check which languages *would* have run
        const detected = LANG_DIAGNOSTICS.filter((r) => r.detect(ctx.cwd));
        const parts: string[] = [];

        if (detected.length === 0) {
          parts.push(
            "No supported project detected. " +
            "Diagnostics currently support: TypeScript (tsconfig.json), Rust (Cargo.toml), " +
            "Go (go.mod), Python (pyproject.toml / setup.py)."
          );
        } else {
          parts.push(
            "All diagnostics passed cleanly:\n" +
            detected.map((r) => `  - ${r.label}: no errors`).join("\n")
          );
        }

        // Check if Fallow should have run
        if (!fallowBlock && fs.existsSync(path.join(ctx.cwd, "tsconfig.json"))) {
          parts.push(
            "Fallow (code quality): not available. Install with `npx fallow`."
          );
        }

        return { content: [{ type: "text" as const, text: parts.join("\n\n") }], details: {} };
      }

      const text = allBlocks.join("\n\n");
      return { content: [{ type: "text" as const, text }], details: {} };
    },
  });

  // ===============================================================
  // 2. Auto-inject diagnostics after write/edit
  // ===============================================================
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    if (event.isError) return;

    const rawPath = event.input?.path as string | undefined;
    if (!rawPath) return;

    const filePath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(ctx.cwd, rawPath);

    if (shouldSkipAuto(filePath)) return;

    // Find runners that match this file extension
    const ext = path.extname(filePath).toLowerCase();
    const matchingRunners = EXT_TO_RUNNERS.get(ext);
    if (!matchingRunners || matchingRunners.length === 0) return;

    // Filter to runners whose project markers are actually present
    const activeRunners = matchingRunners.filter((r) => r.detect(ctx.cwd));
    if (activeRunners.length === 0) return;

    // Update debounce (project-wide)
    lastRunTimestamp = Date.now();

    // Run diagnostics for matching languages only
    const jobs = activeRunners.map((r) => runOne(r, ctx.cwd));
    const results = (await Promise.all(jobs)).filter(Boolean);

    if (results.length === 0) return;

    const separator = "\n\n---\n";
    const text = results.join("\n");
    return {
      content: [
        ...event.content,
        { type: "text" as const, text: `${separator}${text}` },
      ],
    };
  });
}
