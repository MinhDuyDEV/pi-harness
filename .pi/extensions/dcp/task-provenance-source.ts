import type { RecallEntry } from "./recall-types.js";

const TASK_PROVENANCE_SPECIFIER = "@minhduydev/pi-subagents/replay";
const MAX_ENTRIES = 200;
const MAX_IDENTITY_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 1_000;

type TaskRecallEntry = Omit<RecallEntry, "index">;
type ModuleLoader = (specifier: string) => Promise<unknown>;

export interface TaskProvenanceRecallLoad {
  status: "loaded" | "not-installed" | "error";
  entries: TaskRecallEntry[];
  warning?: string;
}

interface TaskProvenanceModule {
  listTaskProvenance(input: {
    projectDirectory: string;
    limit: number;
  }): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isEnum(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === "string" && allowed.includes(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isTaskProvenanceModule(value: unknown): value is TaskProvenanceModule {
  return isRecord(value) && typeof value.listTaskProvenance === "function";
}

function isTargetMissing(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
    error.message.includes("@minhduydev/pi-subagents")
  );
}

/** Validate the producer response again at the harness trust boundary. */
export function normalizeTaskProvenanceEntries(value: unknown): TaskRecallEntry[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) return [];
  const entries: TaskRecallEntry[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      item.version !== 1 ||
      item.producer !== "pi-subagents" ||
      !boundedString(item.invocationId, MAX_IDENTITY_LENGTH) ||
      (item.taskId !== undefined && !boundedString(item.taskId, MAX_IDENTITY_LENGTH)) ||
      (item.agentType !== undefined && !boundedString(item.agentType, MAX_IDENTITY_LENGTH)) ||
      (item.description !== undefined && !boundedString(item.description, MAX_DESCRIPTION_LENGTH)) ||
      !isEnum(item.executionPhase, ["allocating", "starting", "working", "blocked", "completed", "failed", "cancelled", "timeout"]) ||
      !isEnum(item.reportedOutcome, ["unknown", "success", "failure", "blocked", "partial", "reframed", "awaiting-decision"]) ||
      !isEnum(item.verificationPhase, ["not-required", "pending", "receipt-passed", "passed", "failed"]) ||
      !isEnum(item.reviewPhase, ["not-required", "awaiting", "accepted", "rejected"]) ||
      !isIsoTimestamp(item.startedAt) ||
      !isIsoTimestamp(item.updatedAt) ||
      (item.resultDigest !== undefined &&
        (typeof item.resultDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(item.resultDigest)))
    ) {
      continue;
    }
    const taskIdentity = typeof item.taskId === "string" ? item.taskId : item.invocationId;
    entries.push({
      source: "task",
      title: `[task:${taskIdentity}]${typeof item.description === "string" ? ` ${item.description}` : ""}`,
      text: [
        `Invocation: ${item.invocationId}`,
        typeof item.agentType === "string" ? `Agent: ${item.agentType}` : "",
        `Execution: ${item.executionPhase}`,
        `Outcome: ${item.reportedOutcome}`,
        `Verification: ${item.verificationPhase}`,
        `Review: ${item.reviewPhase}`,
        `Started: ${item.startedAt}`,
        `Updated: ${item.updatedAt}`,
        typeof item.resultDigest === "string" ? `Result digest: ${item.resultDigest}` : "",
      ].filter(Boolean).join("\n"),
      timestamp: Date.parse(item.updatedAt),
    });
  }
  return entries;
}

export async function loadTaskProvenanceRecall(
  projectDirectory: string,
  loader: ModuleLoader = async (specifier) => import(specifier),
): Promise<TaskProvenanceRecallLoad> {
  try {
    const module = await loader(TASK_PROVENANCE_SPECIFIER);
    if (!isTaskProvenanceModule(module)) {
      return {
        status: "error",
        entries: [],
        warning: `${TASK_PROVENANCE_SPECIFIER} does not export listTaskProvenance`,
      };
    }
    const raw = await module.listTaskProvenance({ projectDirectory, limit: MAX_ENTRIES });
    return { status: "loaded", entries: normalizeTaskProvenanceEntries(raw) };
  } catch (error) {
    if (isTargetMissing(error)) return { status: "not-installed", entries: [] };
    return {
      status: "error",
      entries: [],
      warning: `Task provenance recall unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
