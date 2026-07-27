/**
 * Cross-process contention fixture for the reconcile trigger.
 *
 * `withStateLock` layers an in-process queue (`stateQueues`) on top of a
 * filesystem lock (`open(lockPath, "wx")`), so `Promise.all` inside one process
 * never truly contends — the operations serialize on the queue before they
 * reach the lock file. These fixtures spawn real child processes (see
 * `fixtures/reconcile-contention-worker.ts`) that all wait on a shared start
 * barrier and then hit the same project root at once, so the filesystem lock +
 * `completedSinceLast` CAS + `seenEventIds` dedup paths run under genuine
 * concurrency.
 *
 * This closes the §6 gap from the 2026-07-27 audit/rebuttal for F-17: the
 * inter-process file lock and the CAS consume were implemented and held in the
 * sequential `workflow-state.test.ts`, but were never proven under
 * interleaving.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test, { after } from "node:test";
import {
  readReconcileTriggerState,
  recordCompletionSignal,
} from "./reconcile-trigger.ts";

const WORKER = join(import.meta.dirname, "fixtures", "reconcile-contention-worker.ts");
// tsx is a workspace dependency of pi-harness; the child must resolve it from
// here regardless of the directory the suite was launched from.
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const RUNNER_ARGS = ["--import", "tsx"];

const temporaryProjects: string[] = [];

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reconcile-contention-"));
  await mkdir(join(root, ".pi"), { recursive: true });
  temporaryProjects.push(root);
  return root;
}

interface WorkerLine {
  phase: "ready" | "done";
  ok?: boolean;
  result?: { [key: string]: unknown };
  error?: string;
  name?: string;
}

interface WorkerHandle {
  child: ChildProcess;
  ready: Promise<void>;
  done: Promise<WorkerLine>;
}

function spawnWorker(argSet: string[]): WorkerHandle {
  const child = spawn("node", [...RUNNER_ARGS, WORKER, ...argSet], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: REPO_ROOT,
    // The extension test runner injects its own loader via NODE_OPTIONS; the
    // child must run plain `node --import tsx`, so drop inherited loader flags.
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  let buffer = "";
  let stderrText = "";
  let readyResolve: () => void = () => undefined;
  let doneResolve: (line: WorkerLine) => void = () => undefined;
  let settled = false;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  const done = new Promise<WorkerLine>((resolve) => {
    doneResolve = resolve;
  });
  const settle = (line: WorkerLine) => {
    // A worker that crashes before the barrier must still unblock the ready
    // gate, otherwise Promise.all(ready) hangs until the test times out.
    readyResolve();
    if (settled) return;
    settled = true;
    doneResolve(line);
    if (line.name === "WorkerCrash") console.error(`[reconcile worker] ${line.error}`);
  };
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const raw = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!raw) continue;
      try {
        const line = JSON.parse(raw) as WorkerLine;
        if (line.phase === "ready") readyResolve();
        if (line.phase === "done") settle(line);
      } catch {
        // tsx or the runtime may emit a stray line; only JSON lines matter.
      }
    }
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderrText += chunk;
  });
  child.on("error", (error) =>
    settle({ phase: "done", ok: false, error: error.message, name: error.name }),
  );
  child.on("exit", (code) => {
    if (!settled) {
      settle({
        phase: "done",
        ok: false,
        error: `worker exited without a done line (code=${code})${
          stderrText ? ": " + stderrText.trim().slice(0, 600) : ""
        }`,
        name: "WorkerCrash",
      });
    }
  });
  return { child, ready, done };
}

async function runContention(
  startPath: string,
  argSets: string[][],
): Promise<WorkerLine[]> {
  const handles = argSets.map((argSet) => spawnWorker([...argSet, "--start", startPath]));
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("reconcile contention fixture timed out")), 30_000);
  });
  try {
    await Promise.race([Promise.all(handles.map((handle) => handle.ready)), timeout]);
    await mkdir(dirname(startPath), { recursive: true });
    await writeFile(startPath, "");
    const results = await Promise.race([
      Promise.all(handles.map((handle) => handle.done)),
      timeout,
    ]);
    return results;
  } finally {
    if (timer) clearTimeout(timer);
    for (const handle of handles) {
      if (handle.child.exitCode === null) handle.child.kill("SIGKILL");
    }
  }
}

function winners(results: WorkerLine[]): WorkerLine[] {
  return results.filter((result) => result.phase === "done" && result.ok);
}

function losers(results: WorkerLine[]): WorkerLine[] {
  return results.filter((result) => result.phase === "done" && !result.ok);
}

test("lets exactly one process consume a reconcile trigger when two race the same watermark", async () => {
  const project = await temporaryProject();
  const start = join(project, "start");
  // Pre-seed completedSinceLast=3 with three distinct completion events.
  for (let index = 0; index < 3; index += 1) {
    await recordCompletionSignal(project, { eventId: `seed-${index}`, increment: 1 });
  }
  const seeded = await readReconcileTriggerState(project);
  assert.equal(seeded.completedSinceLast, 3);

  const results = await runContention(start, [
    ["--op", "consume", "--project", project, "--completed", "3"],
    ["--op", "consume", "--project", project, "--completed", "3"],
  ]);

  assert.equal(winners(results).length, 1);
  assert.equal(losers(results).length, 1);
  assert.match(
    losers(results)[0]!.error ?? "",
    /completed_since_last must match durable state/u,
  );

  const final = await readReconcileTriggerState(project);
  assert.equal(final.completedSinceLast, 0);
});

test("deduplicates concurrent completion signals that share an event id", async () => {
  const project = await temporaryProject();
  const start = join(project, "start");
  const workers = 4;
  const sharedEvent = "shared-completion-event";

  const results = await runContention(
    start,
    Array.from({ length: workers }, () => [
      "--op",
      "record",
      "--project",
      project,
      "--event",
      sharedEvent,
    ]),
  );

  // Every worker resolves (duplicate records are no-ops, not errors), but the
  // watermark must advance by exactly one — not by `workers`.
  assert.equal(winners(results).length, workers);
  assert.equal(losers(results).length, 0);

  const final = await readReconcileTriggerState(project);
  assert.equal(final.completedSinceLast, 1);
  assert.deepEqual(final.seenEventIds, [sharedEvent]);
});

after(async () => {
  await Promise.all(
    temporaryProjects
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});