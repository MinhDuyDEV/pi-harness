import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  parseWorkflowCheckpoint,
  workflowCheckpointDigest,
} from "@minhduydev/pi-core/workflow";
import workflowStateExtension, {
  checkpointFromToolInput,
  workflowStateParameters,
} from "./index.ts";
import {
  consumeReconcileTrigger,
  markReconcilePrompted,
  parseCompletionSignal,
  readReconcileTriggerState,
  recordCompletionSignal,
  RECONCILE_COMPLETION_THRESHOLD,
  resetReconcileTrigger,
} from "./reconcile-trigger.ts";
import {
  persistWorkflowCheckpoint,
  workflowRecordPath,
} from "./storage.ts";

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "workflow-state-"));
  await mkdir(path.join(root, ".pi"), { recursive: true });
  return root;
}

const execFileAsync = promisify(execFile);

function foundation(recordId = "foundation-1", rationale = "The base is sound") {
  return checkpointFromToolInput(
    {
      action: "record_foundation",
      record_id: recordId,
      work_session: "work-1",
      verdict: "sound",
      rationale,
      evidence: ["src/index.ts:10"],
      constraints: [{
        statement: "Keep the public API stable",
        classification: "verified",
        evidence: "README.md:20",
      }],
    },
    "2026-07-27T00:00:00.000Z",
    "session-1",
  );
}

test("workflow_state exposes a provider-compatible root object schema", () => {
  assert.equal(
    (workflowStateParameters as unknown as { type?: string }).type,
    "object",
  );
});

test("tool mappings round-trip through the shared pi-core workflow parser", () => {
  const handoff = checkpointFromToolInput(
    {
      action: "record_handoff",
      record_id: "handoff-1",
      title: "Transfer the audit",
      receiver: "agent",
      goal: "Finish verification",
      current_state: "Implementation is complete",
      verified: ["typecheck passed"],
      unknowns: ["registry state"],
      real_constraints: ["do not publish"],
      relevant_files: ["src/index.ts"],
      closed_decisions: ["use the shared contract"],
      open_decisions: ["publish timing"],
      existing_evidence: ["artifacts/test.log"],
      expected_deliverable: "A green release check",
      permissions: ["modify tests"],
      anti_patterns: ["no self-reported proof"],
      next_step: "Run the packed smoke test",
      resume_task_id: "task-1",
    },
    "2026-07-27T00:00:00.000Z",
  );

  assert.equal(handoff.kind, "handoff");
  assert.deepEqual(parseWorkflowCheckpoint(handoff), handoff);
  assert.deepEqual(Object.keys(handoff).sort(), [
    "antiPatterns",
    "closedDecisions",
    "currentState",
    "existingEvidence",
    "expectedDeliverable",
    "goal",
    "kind",
    "nextStep",
    "openDecisions",
    "permissions",
    "realConstraints",
    "receiver",
    "recordId",
    "recordedAt",
    "relevantFiles",
    "resumeKeys",
    "title",
    "unknowns",
    "verified",
    "version",
  ]);
});

test("workflow records are write-once, digest-bound, and idempotent", async () => {
  const root = await temporaryProject();
  try {
    const record = foundation();
    const first = await persistWorkflowCheckpoint(root, record);
    const duplicate = await persistWorkflowCheckpoint(root, record);
    assert.equal(first.status, "created");
    assert.equal(duplicate.status, "duplicate");
    assert.equal(first.path, workflowRecordPath(root, record));

    const stored = JSON.parse(await readFile(first.path, "utf8"));
    assert.equal(stored.digest, workflowCheckpointDigest(record));
    assert.deepEqual(parseWorkflowCheckpoint(stored.record), record);

    await assert.rejects(
      persistWorkflowCheckpoint(root, foundation("foundation-1", "Changed verdict rationale")),
      /immutable/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("completion threshold is durable and duplicate signals are idempotent", async () => {
  const root = await temporaryProject();
  try {
    for (let index = 1; index <= RECONCILE_COMPLETION_THRESHOLD; index++) {
      const result = await recordCompletionSignal(root, {
        eventId: `event-${index}`,
        increment: 1,
      });
      assert.equal(result.becameDue, index === RECONCILE_COMPLETION_THRESHOLD);
    }
    const duplicate = await recordCompletionSignal(root, {
      eventId: "event-4",
      increment: 1,
    });
    assert.equal(duplicate.state.completedSinceLast, RECONCILE_COMPLETION_THRESHOLD);
    assert.equal(duplicate.becameDue, false);

    const recovered = await readReconcileTriggerState(root);
    assert.equal(recovered.due, true);
    await markReconcilePrompted(root, "session-1");
    assert.deepEqual(
      (await readReconcileTriggerState(root)).promptedSessionIds,
      ["session-1"],
    );
    const reset = await resetReconcileTrigger(root);
    assert.equal(reset.completedSinceLast, 0);
    assert.equal(reset.due, false);
    assert.deepEqual(reset.promptedSessionIds, []);
    assert.equal(reset.seenEventIds.length, RECONCILE_COMPLETION_THRESHOLD);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent completion writers serialize without losing increments", async () => {
  const root = await temporaryProject();
  try {
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        recordCompletionSignal(root, {
          eventId: `concurrent-${index}`,
          increment: 1,
        }),
      ),
    );
    const state = await readReconcileTriggerState(root);
    assert.equal(state.completedSinceLast, 8);
    assert.equal(state.seenEventIds.length, 8);
    assert.equal(state.due, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reconcile consume and a concurrent completion cannot lose the new signal", async () => {
  const root = await temporaryProject();
  try {
    for (let index = 0; index < RECONCILE_COMPLETION_THRESHOLD; index += 1) {
      await recordCompletionSignal(root, { eventId: `seed-${index}`, increment: 1 });
    }
    let allowPersist!: () => void;
    const persistCanFinish = new Promise<void>((resolve) => {
      allowPersist = resolve;
    });
    let persistStarted!: () => void;
    const persistDidStart = new Promise<void>((resolve) => {
      persistStarted = resolve;
    });
    const consume = consumeReconcileTrigger(
      root,
      { trigger: "completion-threshold", completedSinceLast: 4 },
      async () => {
        persistStarted();
        await persistCanFinish;
        return "persisted";
      },
    );
    await persistDidStart;
    const completion = recordCompletionSignal(root, { eventId: "arrived-during-consume", increment: 1 });
    allowPersist();
    assert.equal((await consume).persisted, "persisted");
    await completion;
    const state = await readReconcileTriggerState(root);
    assert.equal(state.completedSinceLast, 1);
    assert.equal(state.due, false);
    assert.ok(state.seenEventIds.includes("arrived-during-consume"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("separate processes serialize completion updates with the file lock", async () => {
  const root = await temporaryProject();
  const worker = [
    'import { recordCompletionSignal } from "./.pi/extensions/workflow-state/reconcile-trigger.ts";',
    "await recordCompletionSignal(process.argv[1], { eventId: process.argv[2], increment: 1 });",
  ].join("\n");
  try {
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        execFileAsync(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "--eval", worker, root, `process-${index}`],
          { cwd: path.resolve(import.meta.dirname, "../../..") },
        ),
      ),
    );
    const state = await readReconcileTriggerState(root);
    assert.equal(state.completedSinceLast, 6);
    assert.equal(state.seenEventIds.length, 6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("todo completion parser rejects malformed events and bounds phase weight", () => {
  assert.deepEqual(
    parseCompletionSignal("pi-todo:item-completed:v1", {
      idempotencyKey: "item-1",
    }),
    { eventId: "item-1", increment: 1 },
  );
  assert.deepEqual(
    parseCompletionSignal("pi-todo:phase-closed:v1", {
      eventId: "phase-1",
      completedCount: 500,
    }),
    { eventId: "phase-1", increment: 100 },
  );
  assert.equal(
    parseCompletionSignal("pi-todo:phase-closed:v1", {
      eventId: "phase-bad",
      completedCount: -1,
    }),
    undefined,
  );
});

test("malformed reconcile trigger state is quarantined instead of trusted", async () => {
  const root = await temporaryProject();
  try {
    const directory = path.join(root, ".pi", "artifacts", "workflow-state");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "reconcile-trigger.json"),
      '{"version":1,"completedSinceLast":"forged"}\n',
    );
    assert.deepEqual(await readReconcileTriggerState(root), {
      version: 1,
      completedSinceLast: 0,
      due: false,
      seenEventIds: [],
      promptedSessionIds: [],
    });
    assert.ok(
      (await readdir(directory)).some((name) =>
        name.startsWith("reconcile-trigger.json.corrupt-"),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standard profile registers the tool and emits a typed persisted signal", async () => {
  const root = await temporaryProject();
  const previous = process.cwd();
  try {
    await writeFile(
      path.join(root, ".pi", "settings.json"),
      '{"pi-harness":{"profile":"standard"}}\n',
    );
    process.chdir(root);
    let tool: any;
    const emitted: Array<{ channel: string; payload: any }> = [];
    const pi = {
      registerTool(value: unknown) {
        tool = value;
      },
      on() {},
      events: {
        on() {},
        emit(channel: string, payload: unknown) {
          emitted.push({ channel, payload });
        },
      },
    };
    workflowStateExtension(pi as any);
    assert.equal(tool.name, "workflow_state");

    const result = await tool.execute(
      "call-1",
      {
        action: "record_foundation",
        record_id: "foundation-runtime-1",
        work_session: "work-1",
        verdict: "sound",
        rationale: "The verified base supports this change",
        evidence: ["src/index.ts:10"],
        constraints: [],
      },
      undefined,
      undefined,
      {
        cwd: root,
        sessionManager: { getSessionId: () => "session-runtime" },
      },
    );
    assert.equal(result.details.status, "created");
    assert.equal(emitted[0].channel, "pi-harness:workflow:checkpoint-recorded:v1");
    assert.equal(emitted[0].payload.record.kind, "foundation-verdict");
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});

test("reconcile writes must match the durable completion trigger before it is reset", async () => {
  const root = await temporaryProject();
  const previous = process.cwd();
  try {
    await writeFile(
      path.join(root, ".pi", "settings.json"),
      '{"pi-harness":{"profile":"standard"}}\n',
    );
    process.chdir(root);
    let tool: any;
    const pi = {
      registerTool(value: unknown) { tool = value; },
      on() {},
      events: { on() {}, emit() {} },
    };
    workflowStateExtension(pi as any);
    for (let index = 0; index < RECONCILE_COMPLETION_THRESHOLD; index++) {
      await recordCompletionSignal(root, { eventId: `runtime-${index}`, increment: 1 });
    }
    const input = {
      action: "record_reconcile",
      record_id: "reconcile-runtime-1",
      scope: "current TODO phase",
      trigger: "completion-threshold",
      completed_since_last: RECONCILE_COMPLETION_THRESHOLD - 1,
      proposals: [],
    };
    const ctx = {
      cwd: root,
      sessionManager: { getSessionId: () => "session-runtime" },
    };
    await assert.rejects(
      tool.execute("call-bad", input, undefined, undefined, ctx),
      /must match durable state/,
    );
    assert.equal((await readReconcileTriggerState(root)).due, true);

    const result = await tool.execute(
      "call-good",
      { ...input, completed_since_last: RECONCILE_COMPLETION_THRESHOLD },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(result.details.status, "created");
    assert.equal((await readReconcileTriggerState(root)).due, false);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});
