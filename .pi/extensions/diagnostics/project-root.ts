import fs from "node:fs";
import path from "node:path";
import { LANG_DIAGNOSTICS } from "./lang-runners.ts";

const DEFAULT_MAX_WALK = 6;

function maxWalkDepth(): number {
  const raw = process.env.PI_DIAGNOSTICS_ROOT_WALK;
  if (!raw) return DEFAULT_MAX_WALK;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MAX_WALK;
}

export function isDiagnosticsProjectRoot(dir: string): boolean {
  return LANG_DIAGNOSTICS.some((r) => r.detect(dir));
}

/**
 * Resolve directory where compile/lint/Fallow should run.
 * Order: PI_DIAGNOSTICS_ROOT (if valid) → walk parents from startCwd → startCwd.
 */
export function resolveDiagnosticsProjectRoot(startCwd: string): {
  projectRoot: string;
  sessionCwd: string;
  walkedUp: boolean;
} {
  const sessionCwd = path.resolve(startCwd);

  const forced = process.env.PI_DIAGNOSTICS_ROOT?.trim();
  if (forced) {
    const abs = path.resolve(sessionCwd, forced);
    if (isDiagnosticsProjectRoot(abs)) {
      return { projectRoot: abs, sessionCwd, walkedUp: abs !== sessionCwd };
    }
  }

  let current = sessionCwd;
  const limit = maxWalkDepth();
  for (let i = 0; i <= limit; i++) {
    if (isDiagnosticsProjectRoot(current)) {
      return { projectRoot: current, sessionCwd, walkedUp: current !== sessionCwd };
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return { projectRoot: sessionCwd, sessionCwd, walkedUp: false };
}

export function hasTsProject(root: string): boolean {
  return fs.existsSync(path.join(root, "tsconfig.json"));
}