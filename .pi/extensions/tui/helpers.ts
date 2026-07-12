/**
 * Shared helpers for the TUI extension.
 *
 * Consolidates functions that were duplicated across multiple files:
 *   - hasNerdFonts (was in footer.ts, editor-prompt.ts)
 *   - formatCost (was in footer.ts, sidebar.ts)
 *   - fmtNum (was in footer.ts, sidebar.ts)
 *   - stripAnsi (was in cluster.ts, compositor.ts)
 */

// ── Nerd Font detection ────────────────────────────────────────────────────

export function hasNerdFonts(): boolean {
  if (process.env.POWERLINE_NERD_FONTS === "1") return true;
  if (process.env.POWERLINE_NERD_FONTS === "0") return false;
  return false;
}

// ── Formatting ─────────────────────────────────────────────────────────────

export function formatCost(usd: number): string {
  const safeUsd = Math.max(0, usd);
  if (safeUsd > 0 && safeUsd < 0.01) return `$${safeUsd.toFixed(4)}`;
  return `$${safeUsd.toFixed(2)}`;
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return "" + n;
}

// ── ANSI stripping ─────────────────────────────────────────────────────────

export function stripAnsi(line: string): string {
  return line.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[@-_]/g, "");
}
