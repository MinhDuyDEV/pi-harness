import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  makeWorkflowCheckpoint,
  MAX_WORKFLOW_ID_LENGTH,
  MAX_WORKFLOW_LIST_ITEMS,
  MAX_WORKFLOW_TEXT_LENGTH,
  type WorkflowCheckpointV1,
} from "@minhduydev/pi-core/workflow";
import { readExtensionGate } from "../lib/harness-settings.js";
import {
  consumeReconcileTrigger,
  markReconcilePrompted,
  parseCompletionSignal,
  readReconcileTriggerState,
  recordCompletionSignal,
  RECONCILE_COMPLETION_THRESHOLD,
} from "./reconcile-trigger.js";
import { persistWorkflowCheckpoint } from "./storage.js";

const boundedText = () =>
  Type.String({ minLength: 1, maxLength: MAX_WORKFLOW_TEXT_LENGTH });
const boundedId = () =>
  Type.String({ minLength: 1, maxLength: MAX_WORKFLOW_ID_LENGTH });
const textList = () =>
  Type.Array(boundedText(), { maxItems: MAX_WORKFLOW_LIST_ITEMS });

const foundationParameters = Type.Object({
  action: Type.Literal("record_foundation"),
  record_id: boundedId(),
  work_session: boundedId(),
  verdict: Type.Union([
    Type.Literal("sound"),
    Type.Literal("repair-first"),
    Type.Literal("accepted-risk"),
  ]),
  rationale: boundedText(),
  evidence: textList(),
  constraints: Type.Array(
    Type.Object({
      statement: boundedText(),
      classification: Type.Union([
        Type.Literal("verified"),
        Type.Literal("preference"),
      ]),
      evidence: Type.Optional(boundedText()),
    }),
    { maxItems: MAX_WORKFLOW_LIST_ITEMS },
  ),
});

const reconcileParameters = Type.Object({
  action: Type.Literal("record_reconcile"),
  record_id: boundedId(),
  scope: boundedText(),
  trigger: Type.Union([
    Type.Literal("explicit"),
    Type.Literal("completion-threshold"),
  ]),
  completed_since_last: Type.Integer({ minimum: 0 }),
  proposals: Type.Array(
    Type.Union([
      Type.Object({
        action: Type.Literal("close"),
        task: boundedText(),
        evidence: textList(),
      }),
      Type.Object({
        action: Type.Literal("reorder"),
        task: boundedText(),
        evidence: textList(),
        before_task: boundedText(),
      }),
    ]),
    { maxItems: MAX_WORKFLOW_LIST_ITEMS },
  ),
});

const handoffParameters = Type.Object({
  action: Type.Literal("record_handoff"),
  record_id: boundedId(),
  title: boundedText(),
  receiver: Type.Union([Type.Literal("agent"), Type.Literal("session")]),
  goal: boundedText(),
  current_state: boundedText(),
  verified: textList(),
  unknowns: textList(),
  real_constraints: textList(),
  relevant_files: textList(),
  closed_decisions: textList(),
  open_decisions: textList(),
  existing_evidence: textList(),
  expected_deliverable: boundedText(),
  permissions: textList(),
  anti_patterns: textList(),
  next_step: boundedText(),
  resume_task_id: Type.Optional(boundedId()),
  resume_conversation_id: Type.Optional(boundedId()),
});

export const workflowStateParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("record_foundation"),
      Type.Literal("record_reconcile"),
      Type.Literal("record_handoff"),
    ]),
    record_id: boundedId(),
  },
  {
    // Some OpenAI-compatible providers reject a tool schema whose root is an
    // `anyOf` without `type: "object"`. Keep the discriminated variants for
    // validation while exposing an object at the provider boundary.
    anyOf: [foundationParameters, reconcileParameters, handoffParameters],
  },
);

type WorkflowToolInput =
  | {
      action: "record_foundation";
      record_id: string;
      work_session: string;
      verdict: "sound" | "repair-first" | "accepted-risk";
      rationale: string;
      evidence: string[];
      constraints: Array<{
        statement: string;
        classification: "verified" | "preference";
        evidence?: string;
      }>;
    }
  | {
      action: "record_reconcile";
      record_id: string;
      scope: string;
      trigger: "explicit" | "completion-threshold";
      completed_since_last: number;
      proposals: Array<
        | { action: "close"; task: string; evidence: string[] }
        | {
            action: "reorder";
            task: string;
            evidence: string[];
            before_task: string;
          }
      >;
    }
  | {
      action: "record_handoff";
      record_id: string;
      title: string;
      receiver: "agent" | "session";
      goal: string;
      current_state: string;
      verified: string[];
      unknowns: string[];
      real_constraints: string[];
      relevant_files: string[];
      closed_decisions: string[];
      open_decisions: string[];
      existing_evidence: string[];
      expected_deliverable: string;
      permissions: string[];
      anti_patterns: string[];
      next_step: string;
      resume_task_id?: string;
      resume_conversation_id?: string;
    };

function sessionId(ctx: ExtensionContext): string | undefined {
  try {
    const value = ctx.sessionManager.getSessionId();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function checkpointFromToolInput(
  input: WorkflowToolInput,
  recordedAt: string,
  currentSessionId?: string,
): WorkflowCheckpointV1 {
  const shared = {
    version: 1 as const,
    recordId: input.record_id,
    recordedAt,
    ...(currentSessionId ? { sessionId: currentSessionId } : {}),
  };
  if (input.action === "record_foundation") {
    return makeWorkflowCheckpoint({
      ...shared,
      kind: "foundation-verdict",
      workSession: input.work_session,
      verdict: input.verdict,
      rationale: input.rationale,
      evidence: input.evidence,
      constraints: input.constraints,
    });
  }
  if (input.action === "record_reconcile") {
    return makeWorkflowCheckpoint({
      ...shared,
      kind: "reconcile-checkpoint",
      scope: input.scope,
      trigger: input.trigger,
      completedSinceLast: input.completed_since_last,
      proposals: input.proposals.map((proposal) =>
        proposal.action === "reorder"
          ? {
              action: proposal.action,
              task: proposal.task,
              evidence: proposal.evidence,
              beforeTask: proposal.before_task,
            }
          : proposal,
      ),
    });
  }
  return makeWorkflowCheckpoint({
    ...shared,
    kind: "handoff",
    title: input.title,
    receiver: input.receiver,
    goal: input.goal,
    currentState: input.current_state,
    verified: input.verified,
    unknowns: input.unknowns,
    realConstraints: input.real_constraints,
    relevantFiles: input.relevant_files,
    closedDecisions: input.closed_decisions,
    openDecisions: input.open_decisions,
    existingEvidence: input.existing_evidence,
    expectedDeliverable: input.expected_deliverable,
    permissions: input.permissions,
    antiPatterns: input.anti_patterns,
    nextStep: input.next_step,
    resumeKeys: {
      ...(input.resume_task_id ? { taskId: input.resume_task_id } : {}),
      ...(input.resume_conversation_id
        ? { conversationId: input.resume_conversation_id }
        : {}),
    },
  });
}

export default function workflowStateExtension(pi: ExtensionAPI): void {
  if (!readExtensionGate(undefined, "workflowState", false)) return;
  let active:
    | { projectRoot: string; sessionId: string; context: ExtensionContext }
    | undefined;
  let completionQueue: Promise<void> = Promise.resolve();

  pi.registerTool<typeof workflowStateParameters, {
    kind: WorkflowCheckpointV1["kind"];
    recordId: string;
    digest: string;
    path: string;
    status: "created" | "duplicate";
  }>({
    name: "workflow_state",
    label: "workflow_state",
    description:
      "Persist a typed foundation verdict, backlog reconciliation checkpoint, or complete 14-section handoff. Records are validated by @minhduydev/pi-core and are immutable by record_id.",
    parameters: workflowStateParameters,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
      const params = rawParams as WorkflowToolInput;
      await completionQueue;
      const record = checkpointFromToolInput(
        params,
        new Date().toISOString(),
        sessionId(ctx),
      );
      const persisted = record.kind === "reconcile-checkpoint"
        ? (await consumeReconcileTrigger(
            ctx.cwd,
            {
              trigger: record.trigger,
              completedSinceLast: record.completedSinceLast,
            },
            () => persistWorkflowCheckpoint(ctx.cwd, record),
          )).persisted
        : await persistWorkflowCheckpoint(ctx.cwd, record);
      const details = {
        kind: record.kind,
        recordId: record.recordId,
        digest: persisted.envelope.digest,
        path: persisted.path,
        status: persisted.status,
      };
      try {
        pi.events.emit("pi-harness:workflow:checkpoint-recorded:v1", {
          version: 1,
          ...details,
          record: persisted.envelope.record,
        });
      } catch {
        // Durable write is authoritative; event delivery is best-effort.
      }
      return {
        content: [{
          type: "text" as const,
          text:
            `Workflow ${record.kind} ${persisted.status}: ${persisted.path}\n` +
            `Digest: ${persisted.envelope.digest}`,
        }],
        details,
      };
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const currentSessionId = sessionId(ctx);
    if (!currentSessionId) return;
    active = { projectRoot: ctx.cwd, sessionId: currentSessionId, context: ctx };
    const state = await readReconcileTriggerState(ctx.cwd);
    if (state.due && ctx.hasUI) {
      ctx.ui.notify(
        `Workflow reconcile due after ${state.completedSinceLast} completed tasks. Run /verify <title> --reconcile.`,
        "warning",
      );
    }
  });

  pi.on("context", async (event) => {
    if (!active) return;
    const state = await readReconcileTriggerState(active.projectRoot);
    if (!state.due || state.promptedSessionIds.includes(active.sessionId)) return;
    await markReconcilePrompted(active.projectRoot, active.sessionId);
    return {
      messages: [
        ...event.messages,
        {
          role: "user" as const,
          content: [{
            type: "text" as const,
            text:
              `[Workflow reconcile due] ${state.completedSinceLast} tasks completed ` +
              `since the last persisted reconcile checkpoint (threshold ` +
              `${RECONCILE_COMPLETION_THRESHOLD}). Reconcile TODO.md, PROGRESS.md, ` +
              `and DECISIONS.md before more feature work; persist the result with ` +
              `workflow_state action=record_reconcile.`,
          }],
          timestamp: Date.now(),
        },
      ],
    };
  });

  const completionChannels = [
    "pi-todo:item-completed:v1",
    "pi-todo:phase-closed:v1",
  ] as const;
  for (const channel of completionChannels) {
    pi.events.on(channel, (payload: unknown) => {
      const signal = parseCompletionSignal(channel, payload);
      if (!signal) return;
      const projectRoot = active?.projectRoot ?? process.cwd();
      completionQueue = completionQueue.catch(() => undefined).then(async () => {
        const result = await recordCompletionSignal(projectRoot, signal);
        if (!result.becameDue) return;
        try {
          pi.events.emit("pi-harness:workflow:reconcile-due:v1", {
            version: 1,
            trigger: "completion-threshold",
            completedSinceLast: result.state.completedSinceLast,
            threshold: RECONCILE_COMPLETION_THRESHOLD,
            eventId: signal.eventId,
          });
        } catch {
          // The durable trigger survives event-bus listener failures.
        }
        if (active?.context.hasUI) {
          active.context.ui.notify(
            `Workflow reconcile due after ${result.state.completedSinceLast} completed tasks.`,
            "warning",
          );
        }
      });
      return completionQueue;
    });
  }
}
