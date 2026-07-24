import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  EMPTY_TREE_SHA,
  LEGACY_ZERO_SHA,
  STORE_REF,
  type RewindRuntimeState,
  isInsidePath,
} from "./core.js";

const execFileAsync = promisify(execFile);

export interface SnapshotStore {
  getRepoRoot(): Promise<string>;
  captureWorktreeTree(): Promise<{ treeSha: string }>;
  getCommitTreeSha(commitSha: string): Promise<string>;
  commitExists(commitSha: string): Promise<boolean>;
  getStoreHead(): Promise<string | undefined>;
  appendSnapshotToStore(commitSha: string): Promise<void>;
  rewriteStoreToLiveSet(liveCommitShas: string[]): Promise<"rewritten" | "preserved-empty">;
  ensureSnapshotForTree(treeSha: string): Promise<string>;
  ensureSnapshotForCurrentWorktree(): Promise<string>;
  restoreCommitExactly(targetCommitSha: string): Promise<{ changed: boolean; undoCommitSha?: string; targetTreeSha: string }>;
}

interface StoreDeps {
  pi: ExtensionAPI;
  state: RewindRuntimeState;
}

export function createSnapshotStore(pi: ExtensionAPI, state: RewindRuntimeState): SnapshotStore {
  const deps = { pi, state };
  return {
    getRepoRoot: () => getRepoRoot(deps),
    captureWorktreeTree: () => captureWorktreeTree(deps),
    getCommitTreeSha: (commitSha) => getCommitTreeSha(deps, commitSha),
    commitExists: (commitSha) => commitExists(deps, commitSha),
    getStoreHead: () => getStoreHead(deps),
    appendSnapshotToStore: (commitSha) => appendSnapshotToStore(deps, commitSha),
    rewriteStoreToLiveSet: (commits) => rewriteStoreToLiveSet(deps, commits),
    ensureSnapshotForTree: (treeSha) => ensureSnapshotForTree(deps, treeSha),
    ensureSnapshotForCurrentWorktree: () => ensureSnapshotForCurrentWorktree(deps),
    restoreCommitExactly: (commitSha) => restoreCommitExactly(deps, commitSha),
  };
}

async function execGitChecked({ pi }: StoreDeps, args: string[]) {
  const result = await pi.exec("git", args);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed with code ${result.code}`);
  return result;
}

async function getRepoRoot(deps: StoreDeps): Promise<string> {
  if (deps.state.repoRoot) return deps.state.repoRoot;
  const result = await execGitChecked(deps, ["rev-parse", "--show-toplevel"]);
  deps.state.repoRoot = result.stdout.trim();
  return deps.state.repoRoot;
}

async function captureWorktreeTree(deps: StoreDeps): Promise<{ treeSha: string }> {
  const root = await getRepoRoot(deps);
  const tempDir = await mkdtemp(join(tmpdir(), "pi-rewind-"));
  const tempIndex = join(tempDir, "index");
  try {
    const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
    await execFileAsync("git", ["add", "-A"], { cwd: root, env });
    const { stdout } = await execFileAsync("git", ["write-tree"], { cwd: root, env });
    return { treeSha: stdout.trim() };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function getCommitTreeSha(deps: StoreDeps, commitSha: string): Promise<string> {
  const root = await getRepoRoot(deps);
  const result = await execFileAsync("git", ["show", "-s", "--format=%T", commitSha], { cwd: root });
  return result.stdout.trim();
}

async function commitExists(deps: StoreDeps, commitSha: string): Promise<boolean> {
  if (!/^[0-9a-fA-F]{4,64}$/.test(commitSha)) return false;
  try {
    const root = await getRepoRoot(deps);
    await execFileAsync("git", ["cat-file", "-e", `${commitSha}^{commit}`], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

async function getStoreHead(deps: StoreDeps): Promise<string | undefined> {
  const result = await deps.pi.exec("git", ["rev-parse", "--verify", STORE_REF]);
  return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

async function createStoreKeepaliveCommit(deps: StoreDeps, snapshotCommitSha: string, previousStoreHead?: string): Promise<string> {
  const args = ["commit-tree", EMPTY_TREE_SHA];
  if (previousStoreHead) args.push("-p", previousStoreHead);
  args.push("-p", snapshotCommitSha, "-m", "pi rewind store");
  const result = await execGitChecked(deps, args);
  return result.stdout.trim();
}

async function appendSnapshotToStore(deps: StoreDeps, commitSha: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const oldHead = await getStoreHead(deps);
    const keepaliveCommit = await createStoreKeepaliveCommit(deps, commitSha, oldHead);
    try {
      await execGitChecked(deps, ["update-ref", STORE_REF, keepaliveCommit, oldHead ?? LEGACY_ZERO_SHA]);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`failed to update rewind store ref: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function rewriteStoreToLiveSet(deps: StoreDeps, liveCommitShas: string[]): Promise<"rewritten" | "preserved-empty"> {
  const commits = [...new Set(liveCommitShas.filter(Boolean))];
  if (commits.length === 0) return "preserved-empty";
  let head: string | undefined;
  for (const commitSha of commits) head = await createStoreKeepaliveCommit(deps, commitSha, head);
  const oldHead = await getStoreHead(deps);
  await execGitChecked(deps, ["update-ref", STORE_REF, head!, oldHead ?? LEGACY_ZERO_SHA]);
  return "rewritten";
}

async function ensureSnapshotForTree(deps: StoreDeps, treeSha: string): Promise<string> {
  if (deps.state.lastExact?.treeSha === treeSha) return deps.state.lastExact.commitSha;
  const result = await execGitChecked(deps, ["commit-tree", treeSha, "-m", "pi rewind snapshot"]);
  const commitSha = result.stdout.trim();
  await appendSnapshotToStore(deps, commitSha);
  deps.state.lastExact = { commitSha, treeSha };
  deps.state.newSnapshotsSinceSweep += 1;
  return commitSha;
}

async function ensureSnapshotForCurrentWorktree(deps: StoreDeps): Promise<string> {
  const { treeSha } = await captureWorktreeTree(deps);
  return ensureSnapshotForTree(deps, treeSha);
}

async function deletePathsFromWorkingTree(deps: StoreDeps, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const root = await getRepoRoot(deps);
  for (const repoRelativePath of paths) {
    const absolutePath = resolve(root, repoRelativePath);
    if (!isInsidePath(absolutePath, root)) throw new Error(`refusing to delete path outside repo root: ${repoRelativePath}`);
    await rm(absolutePath, { recursive: true, force: true });
  }
}

async function restoreCommitExactly(deps: StoreDeps, targetCommitSha: string): Promise<{ changed: boolean; undoCommitSha?: string; targetTreeSha: string }> {
  const { treeSha: currentTreeSha } = await captureWorktreeTree(deps);
  const targetTreeSha = await getCommitTreeSha(deps, targetCommitSha);
  if (currentTreeSha === targetTreeSha) {
    deps.state.lastExact = { commitSha: targetCommitSha, treeSha: targetTreeSha };
    return { changed: false, targetTreeSha };
  }
  const undoCommitSha = await ensureSnapshotForTree(deps, currentTreeSha);
  const deletedPaths = await execGitChecked(deps, ["diff", "--name-only", "--diff-filter=D", "-z", currentTreeSha, targetTreeSha, "--"]);
  await deletePathsFromWorkingTree(deps, deletedPaths.stdout.split("\0").filter(Boolean));
  await execGitChecked(deps, ["restore", `--source=${targetCommitSha}`, "--worktree", "--", "."]);
  deps.state.lastExact = { commitSha: targetCommitSha, treeSha: targetTreeSha };
  return { changed: true, undoCommitSha, targetTreeSha };
}
