import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export const RECONCILE_COMPLETION_THRESHOLD = 4;
const MAX_SEEN_EVENT_IDS = 128;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 5_000;
const LOCK_HEARTBEAT_MS = 5_000;

export interface ReconcileTriggerStateV1 {
  version: 1;
  completedSinceLast: number;
  due: boolean;
  seenEventIds: string[];
  promptedSessionIds: string[];
}

export interface CompletionSignal {
  eventId: string;
  increment: number;
}

const EMPTY_STATE: ReconcileTriggerStateV1 = {
  version: 1,
  completedSinceLast: 0,
  due: false,
  seenEventIds: [],
  promptedSessionIds: [],
};
const stateQueues = new Map<string, Promise<void>>();

function reconcileTriggerLockPath(projectRoot: string): string {
  return `${reconcileTriggerPath(projectRoot)}.lock`;
}

async function acquireFileLock(projectRoot: string): Promise<() => Promise<void>> {
  const lockPath = reconcileTriggerLockPath(projectRoot);
  await mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      const token = randomUUID();
      try {
        await handle.writeFile(
          `${JSON.stringify({
            pid: process.pid,
            token,
            acquiredAt: new Date().toISOString(),
          })}\n`,
        );
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
        throw error;
      }
      const heartbeat = setInterval(() => {
        void readFile(lockPath, "utf8")
          .then((contents) => {
            if (contents.includes(`"token":"${token}"`)) {
              return utimes(lockPath, new Date(), new Date());
            }
            return undefined;
          })
          .catch(() => undefined);
      }, LOCK_HEARTBEAT_MS);
      heartbeat.unref?.();
      return async () => {
        clearInterval(heartbeat);
        await handle.close().catch(() => undefined);
        const contents = await readFile(lockPath, "utf8").catch(() => undefined);
        if (contents?.includes(`"token":"${token}"`)) {
          await unlink(lockPath).catch(() => undefined);
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockStat = await stat(lockPath).catch(() => undefined);
      if (lockStat && Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for reconcile trigger lock: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

async function withStateLock<T>(
  projectRoot: string,
  operation: () => Promise<T>,
): Promise<T> {
  const prior = stateQueues.get(projectRoot) ?? Promise.resolve();
  const current = prior.catch(() => undefined).then(async () => {
    const release = await acquireFileLock(projectRoot);
    try {
      return await operation();
    } finally {
      await release();
    }
  });
  const queued = current.then(
    () => undefined,
    () => undefined,
  );
  stateQueues.set(projectRoot, queued);
  try {
    return await current;
  } finally {
    if (stateQueues.get(projectRoot) === queued) stateQueues.delete(projectRoot);
  }
}

export function reconcileTriggerPath(projectRoot: string): string {
  return join(
    projectRoot,
    ".pi",
    "artifacts",
    "workflow-state",
    "reconcile-trigger.json",
  );
}

function parseState(value: unknown): ReconcileTriggerStateV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (
    input.version !== 1 ||
    !Number.isInteger(input.completedSinceLast) ||
    Number(input.completedSinceLast) < 0 ||
    typeof input.due !== "boolean" ||
    !Array.isArray(input.seenEventIds) ||
    !Array.isArray(input.promptedSessionIds) ||
    input.seenEventIds.length > MAX_SEEN_EVENT_IDS ||
    input.promptedSessionIds.length > 16 ||
    !input.seenEventIds.every(
      (entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 256,
    ) ||
    !input.promptedSessionIds.every(
      (entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 256,
    )
  ) {
    return undefined;
  }
  return {
    version: 1,
    completedSinceLast: Number(input.completedSinceLast),
    due: input.due,
    seenEventIds: [...input.seenEventIds] as string[],
    promptedSessionIds: [...input.promptedSessionIds] as string[],
  };
}

export async function readReconcileTriggerState(
  projectRoot: string,
): Promise<ReconcileTriggerStateV1> {
  const path = reconcileTriggerPath(projectRoot);
  try {
    const parsed = parseState(JSON.parse(await readFile(path, "utf8")));
    if (parsed) return parsed;
    await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => undefined);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => undefined);
    }
  }
  return { ...EMPTY_STATE, seenEventIds: [], promptedSessionIds: [] };
}

async function writeState(
  projectRoot: string,
  state: ReconcileTriggerStateV1,
): Promise<void> {
  const path = reconcileTriggerPath(projectRoot);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary =
    `${path}.${process.pid}.${Date.now()}.` +
    `${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
}

export function parseCompletionSignal(
  channel: "pi-todo:item-completed:v1" | "pi-todo:phase-closed:v1",
  payload: unknown,
): CompletionSignal | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const input = payload as Record<string, unknown>;
  const eventId =
    typeof input.idempotencyKey === "string"
      ? input.idempotencyKey
      : typeof input.eventId === "string"
        ? input.eventId
        : undefined;
  if (!eventId || eventId.length > 256) return undefined;
  if (channel === "pi-todo:item-completed:v1") {
    return { eventId, increment: 1 };
  }
  const completedCount = input.completedCount;
  if (!Number.isInteger(completedCount) || Number(completedCount) < 0) return undefined;
  return {
    eventId,
    increment: Math.max(1, Math.min(Number(completedCount), 100)),
  };
}

export async function recordCompletionSignal(
  projectRoot: string,
  signal: CompletionSignal,
): Promise<{ state: ReconcileTriggerStateV1; becameDue: boolean }> {
  return withStateLock(projectRoot, async () => {
    const state = await readReconcileTriggerState(projectRoot);
    if (state.seenEventIds.includes(signal.eventId)) {
      return { state, becameDue: false };
    }
    const dueBefore = state.due;
    const next: ReconcileTriggerStateV1 = {
      ...state,
      completedSinceLast: state.completedSinceLast + signal.increment,
      seenEventIds: [...state.seenEventIds, signal.eventId].slice(-MAX_SEEN_EVENT_IDS),
    };
    next.due = next.completedSinceLast >= RECONCILE_COMPLETION_THRESHOLD;
    await writeState(projectRoot, next);
    return { state: next, becameDue: !dueBefore && next.due };
  });
}

export async function markReconcilePrompted(
  projectRoot: string,
  sessionId: string,
): Promise<ReconcileTriggerStateV1> {
  return withStateLock(projectRoot, async () => {
    const state = await readReconcileTriggerState(projectRoot);
    if (!state.due || state.promptedSessionIds.includes(sessionId)) return state;
    const next = {
      ...state,
      promptedSessionIds: [...state.promptedSessionIds, sessionId].slice(-16),
    };
    await writeState(projectRoot, next);
    return next;
  });
}

export async function resetReconcileTrigger(
  projectRoot: string,
): Promise<ReconcileTriggerStateV1> {
  return withStateLock(projectRoot, async () => {
    const state = await readReconcileTriggerState(projectRoot);
    const next: ReconcileTriggerStateV1 = {
      ...state,
      completedSinceLast: 0,
      due: false,
      promptedSessionIds: [],
    };
    await writeState(projectRoot, next);
    return next;
  });
}

export async function consumeReconcileTrigger<T>(
  projectRoot: string,
  expected: { trigger: "completion-threshold" | "explicit"; completedSinceLast: number },
  persist: () => Promise<T>,
): Promise<{ persisted: T; state: ReconcileTriggerStateV1 }> {
  return withStateLock(projectRoot, async () => {
    const state = await readReconcileTriggerState(projectRoot);
    if (expected.trigger === "completion-threshold" && !state.due) {
      throw new Error(
        "A completion-threshold reconcile cannot be recorded before the durable threshold is due",
      );
    }
    if (expected.completedSinceLast !== state.completedSinceLast) {
      throw new Error(
        `completed_since_last must match durable state ` +
          `(${state.completedSinceLast}), got ${expected.completedSinceLast}`,
      );
    }
    const persisted = await persist();
    const next: ReconcileTriggerStateV1 = {
      ...state,
      completedSinceLast: 0,
      due: false,
      promptedSessionIds: [],
    };
    await writeState(projectRoot, next);
    return { persisted, state: next };
  });
}
