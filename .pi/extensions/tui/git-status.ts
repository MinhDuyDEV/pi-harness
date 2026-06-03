import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCb);

export interface GitInfo {
  branch: string;
  staged: number;
  unstaged: number;
  untracked: number;
}

/** Cached git info with async refresh. */
let cached: GitInfo | null = null;
let lastFetchAt = 0;
let fetchPromise: Promise<GitInfo | null> | null = null;
const MIN_FETCH_INTERVAL_MS = 1000;

export function invalidateGitStatus() {
  cached = null;
  lastFetchAt = 0;
}

/**
 * Returns the cached git info immediately, or triggers a background fetch
 * and returns null on first call / after invalidation.
 */
export function getCachedGitInfo(): GitInfo | null {
  return cached;
}

/**
 * Fetches git info asynchronously (debounced). Call on tool_result events
 * and periodically from the animation timer.
 */
export async function refreshGitInfo(cwd: string): Promise<GitInfo | null> {
  const now = Date.now();
  if (cached && now - lastFetchAt < MIN_FETCH_INTERVAL_MS) return cached;
  if (fetchPromise) return fetchPromise;

  fetchPromise = doFetch(cwd).finally(() => {
    fetchPromise = null;
  });
  return fetchPromise;
}

async function doFetch(cwd: string): Promise<GitInfo | null> {
  try {
    const { stdout: branchOut } = await exec("git branch --show-current", {
      cwd,
      timeout: 2000,
      windowsHide: true,
    });
    const branch = branchOut.trim();
    if (!branch) return null;

    const { stdout: porcelain } = await exec("git status --porcelain", {
      cwd,
      timeout: 2000,
      windowsHide: true,
    });

    let staged = 0;
    let unstaged = 0;
    let untracked = 0;

    for (const line of porcelain.split("\n")) {
      if (line.length < 3) continue;
      const xy = line[0];
      const yz = line[1];
      if (xy !== " " && xy !== "?") staged++;
      if (yz !== " " && yz !== "?") unstaged++;
      if (line.startsWith("??")) untracked++;
    }

    cached = { branch, staged, unstaged, untracked };
    lastFetchAt = Date.now();
    return cached;
  } catch {
    return null;
  }
}
