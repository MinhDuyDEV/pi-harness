import {
  link,
  mkdir,
  open,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  sha256Hex,
  type TaggedSha256V1,
} from "@minhduydev/pi-core";
import {
  parseWorkflowCheckpoint,
  workflowCheckpointDigest,
  type WorkflowCheckpointV1,
} from "@minhduydev/pi-core/workflow";

export interface WorkflowEnvelopeV1 {
  version: 1;
  digest: TaggedSha256V1;
  record: WorkflowCheckpointV1;
}

export interface PersistedWorkflowCheckpoint {
  path: string;
  envelope: WorkflowEnvelopeV1;
  status: "created" | "duplicate";
}

function parseEnvelope(value: unknown): WorkflowEnvelopeV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const record = parseWorkflowCheckpoint(input.record);
  if (
    input.version !== 1 ||
    !record ||
    input.digest !== workflowCheckpointDigest(record)
  ) {
    return undefined;
  }
  return {
    version: 1,
    digest: input.digest as TaggedSha256V1,
    record,
  };
}

async function readEnvelope(path: string): Promise<WorkflowEnvelopeV1 | undefined> {
  try {
    return parseEnvelope(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return undefined;
  }
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Install a complete temporary file through an exclusive hard link. This is
 * write-once: an existing record id is never overwritten.
 */
async function installExclusive(path: string, content: string): Promise<boolean> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = join(
    directory,
    `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await syncFile(temporary);
    try {
      await link(temporary, path);
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export function workflowRecordPath(
  projectRoot: string,
  record: WorkflowCheckpointV1,
): string {
  // recordId is human-facing and may contain path punctuation. Hashing keeps
  // storage traversal-proof without narrowing the shared pi-core identifier.
  const fileName = `${sha256Hex(record.recordId)}.json`;
  return join(
    projectRoot,
    ".pi",
    "artifacts",
    "workflow-state",
    "records",
    record.kind,
    fileName,
  );
}

export async function persistWorkflowCheckpoint(
  projectRoot: string,
  value: unknown,
): Promise<PersistedWorkflowCheckpoint> {
  const record = parseWorkflowCheckpoint(value);
  if (!record) throw new Error("Workflow checkpoint is malformed or out of bounds");
  const envelope: WorkflowEnvelopeV1 = {
    version: 1,
    digest: workflowCheckpointDigest(record),
    record,
  };
  const path = workflowRecordPath(projectRoot, record);
  const created = await installExclusive(
    path,
    `${JSON.stringify(envelope, null, 2)}\n`,
  );
  if (created) return { path, envelope, status: "created" };

  const existing = await readEnvelope(path);
  if (!existing) {
    throw new Error(`Existing workflow checkpoint is malformed: ${path}`);
  }
  if (existing.digest !== envelope.digest) {
    throw new Error(
      `Workflow checkpoint ${record.recordId} is immutable; use a new recordId for a revision`,
    );
  }
  return { path, envelope: existing, status: "duplicate" };
}
