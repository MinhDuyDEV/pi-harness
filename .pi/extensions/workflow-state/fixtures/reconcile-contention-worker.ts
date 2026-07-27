/**
 * Child-process worker for the cross-process reconcile-trigger contention
 * fixture (see `../reconcile-contention.test.ts`).
 *
 * `withStateLock` layers an in-process queue (`stateQueues`) on top of a
 * filesystem lock (`open(lockPath, "wx")`), so `Promise.all` inside one process
 * never truly contends. The test spawns several copies of this worker, each
 * waits on a shared start barrier, and then hits the same project root at once
 * so the filesystem lock + CAS + `seenEventIds` dedup paths run under genuine
 * concurrency.
 *
 * Line-delimited JSON protocol over stdout:
 *   {"phase":"ready"}                                  — polling the barrier
 *   {"phase":"done","ok":true,"result":{...}}          — op succeeded
 *   {"phase":"done","ok":false,"error":"...","name":..}— op failed
 */
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
  consumeReconcileTrigger,
  recordCompletionSignal,
} from "../reconcile-trigger.ts";

interface Args {
  op: "record" | "consume";
  project: string;
  event?: string;
  completed?: number;
  start: string;
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`bad argv: ${JSON.stringify(argv)}`);
    }
    args[key.slice(2)] = value;
  }
  if (!args.op || !args.project || !args.start) {
    throw new Error("worker requires --op --project --start");
  }
  return args as unknown as Args;
}

async function waitForStart(startPath: string): Promise<void> {
  while (!existsSync(startPath)) await sleep(5);
}

function emit(line: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

async function run(args: Args): Promise<unknown> {
  switch (args.op) {
    case "record": {
      if (!args.event) throw new Error("record requires --event");
      const { state, becameDue } = await recordCompletionSignal(args.project, {
        eventId: args.event,
        increment: 1,
      });
      return { completedSinceLast: state.completedSinceLast, becameDue };
    }
    case "consume": {
      if (args.completed === undefined) throw new Error("consume requires --completed");
      // Explicit trigger skips the `due` short-circuit so the CAS check on
      // `completedSinceLast` is the gate that decides the winner.
      const { state } = await consumeReconcileTrigger(
        args.project,
        { trigger: "explicit", completedSinceLast: Number(args.completed) },
        async () => "persisted",
      );
      return { consumed: true, completedSinceLast: state.completedSinceLast };
    }
    default:
      throw new Error(`unknown op: ${args.op satisfies never}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  emit({ phase: "ready" });
  await waitForStart(args.start);
  try {
    const result = await run(args);
    emit({ phase: "done", ok: true, result });
  } catch (error) {
    emit({
      phase: "done",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Error",
    });
    process.exitCode = 1;
  }
}

void main();