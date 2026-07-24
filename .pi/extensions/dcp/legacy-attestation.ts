import { createHash } from "node:crypto";
import type { CompressionBlock } from "./compress-types.js";
import type { ProvenanceSessionHandle } from "./compress-state.js";
import {
  attestBlock,
  getLegacyStatus,
  getProvenanceCounts,
  quarantineLegacyBlocks,
} from "./compress-state.js";

// Argument parsing

export interface ParsedLegacyArgs {
  command: "inspect" | "attest" | "quarantine";
  /** "all" or a block spec like "b1", "b5" */
  target: string;
  /** Whether --yes was passed */
  forceYes: boolean;
  /** Raw remaining text (empty subcommand fallback) */
  raw: string;
}

/**
 * Parse `/dcp legacy <subcommand> [target] [--yes]`.
 * Returns null for invalid syntax (caller should show help).
 */
export function parseLegacyArgs(raw: string): ParsedLegacyArgs | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  const command = parts[0] as ParsedLegacyArgs["command"];
  if (!["inspect", "attest", "quarantine"].includes(command)) {
    return null;
  }

  let target = "all";
  let forceYes = false;

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--yes") {
      forceYes = true;
    } else if (p.startsWith("b") && /^b\d+$/.test(p)) {
      target = p;
    } else if (p === "all") {
      target = "all";
    } else {
      return null;
    }
  }

  return { command, target, forceYes, raw };
}

// Hashing

/** Compute SHA-256 hex digest of a block's summary text. */
export function getBlockSummaryHash(block: CompressionBlock): string {
  return createHash("sha256").update(block.summary).digest("hex");
}

// Display helpers

function formatBlock(block: CompressionBlock): string {
  const lines: string[] = [];
  const summaryPreview =
    block.summary.length > 120
      ? block.summary.slice(0, 117) + "..."
      : block.summary;
  lines.push(
    `b${block.blockId}  topic="${block.topic}"  tokens=${block.summaryTokens}`,
  );
  lines.push(`  ${summaryPreview}`);

  if (block.attestation) {
    lines.push(
      `  Status: Attested  leaf=${block.attestation.attestationLeafId ?? "none"}  hash=${block.attestation.summaryHash.slice(0, 16)}...`,
    );
  } else if (block.provenance) {
    lines.push(`  Status: Validated (has provenance)`);
  } else {
    lines.push(`  Status: Legacy unverified`);
    lines.push(`  Summary hash: ${getBlockSummaryHash(block).slice(0, 16)}...`);
  }
  return lines.join("\n");
}

function formatStatusHeader(sessionId: string): string {
  const counts = getProvenanceCounts(sessionId);
  const parts: string[] = [];
  parts.push(`Validated: ${counts.validated}`);
  if (counts.attested > 0) parts.push(`Attested: ${counts.attested}`);
  if (counts.legacyUnverified > 0)
    parts.push(`Legacy unverified: ${counts.legacyUnverified}`);
  if (counts.quarantined > 0) parts.push(`Quarantined: ${counts.quarantined}`);
  return parts.join(" | ");
}

// Inspect

function buildInspectOutput(sessionId: string, target: string): string {
  const status = getLegacyStatus(sessionId);
  const lines: string[] = [];

  if (target === "all") {
    lines.push(formatStatusHeader(sessionId));
    lines.push("");

    if (
      status.validated.length === 0 &&
      status.attested.length === 0 &&
      status.unverified.length === 0
    ) {
      lines.push("No compression blocks found.");
      return lines.join("\n");
    }

    const allBlocks = [
      ...status.attested,
      ...status.validated,
      ...status.unverified,
    ].sort((a, b) => a.blockId - b.blockId);

    const maxDisplayedBlocks = 10;
    const visibleBlocks = allBlocks.slice(0, maxDisplayedBlocks);
    for (let i = 0; i < visibleBlocks.length; i++) {
      if (i > 0) lines.push("");
      lines.push(formatBlock(visibleBlocks[i]));
    }

    if (status.quarantined.length > 0) {
      lines.push("");
      lines.push(`Quarantined (${status.quarantined.length}):`);
      for (const qb of status.quarantined.slice(0, maxDisplayedBlocks)) {
        const preview =
          qb.summary.length > 80 ? qb.summary.slice(0, 77) + "..." : qb.summary;
        lines.push(`  ${qb.id}  reason="${qb.reason}"  ${preview}`);
      }
    }
    const omitted =
      Math.max(0, allBlocks.length - maxDisplayedBlocks) +
      Math.max(0, status.quarantined.length - maxDisplayedBlocks);
    if (omitted > 0) lines.push(`… ${omitted} additional blocks omitted`);
  } else {
    const blockId = parseInt(target.slice(1), 10);
    const allBlocks = [
      ...status.attested,
      ...status.validated,
      ...status.unverified,
    ];
    const block = allBlocks.find((b) => b.blockId === blockId);
    if (!block) {
      lines.push(`Block ${target} not found.`);
    } else {
      lines.push(formatBlock(block));
    }
  }

  return lines.join("\n");
}

// Attest

function buildAttestDryRun(
  sessionId: string,
  target: string,
): { blockIds: number[]; display: string } {
  const status = getLegacyStatus(sessionId);

  let candidates: CompressionBlock[];
  if (target === "all") {
    candidates = status.unverified;
  } else {
    const blockId = parseInt(target.slice(1), 10);
    candidates = status.unverified.filter((b) => b.blockId === blockId);
  }

  if (candidates.length === 0) {
    return {
      blockIds: [],
      display:
        target === "all"
          ? "No legacy-unverified blocks to attest."
          : `Block ${target} is not legacy-unverified (already has provenance, attested, or not found).`,
    };
  }

  const lines: string[] = [
    `Attestation will mark the following blocks as legacy_attested:`,
    "",
  ];
  for (const block of candidates) {
    lines.push(
      `  b${block.blockId}  topic="${block.topic}"  hash=${getBlockSummaryHash(block).slice(0, 16)}...`,
    );
  }
  lines.push("");

  return {
    blockIds: candidates.map((b) => b.blockId),
    display: lines.join("\n"),
  };
}

function buildAttestSummary(sessionId: string, count: number): string {
  const counts = getProvenanceCounts(sessionId);
  return `Attested ${count} block(s). Current: ${counts.validated} validated, ${counts.attested} attested, ${counts.legacyUnverified} unverified, ${counts.quarantined} quarantined.`;
}

// Quarantine

function buildQuarantineDryRun(
  sessionId: string,
  target: string,
): { blockIds: number[]; display: string } {
  const status = getLegacyStatus(sessionId);

  let candidates: CompressionBlock[];
  if (target === "all") {
    candidates = status.unverified;
  } else {
    const blockId = parseInt(target.slice(1), 10);
    candidates = status.unverified.filter((b) => b.blockId === blockId);
  }

  if (candidates.length === 0) {
    return {
      blockIds: [],
      display:
        target === "all"
          ? "No legacy-unverified blocks to quarantine."
          : `Block ${target} is not legacy-unverified (already has provenance, attested, or not found).`,
    };
  }

  const lines: string[] = [
    `Quarantine will move the following blocks out of active compression:`,
    "",
  ];
  for (const block of candidates) {
    lines.push(
      `  b${block.blockId}  topic="${block.topic}"  hash=${getBlockSummaryHash(block).slice(0, 16)}...`,
    );
  }
  lines.push("");

  return {
    blockIds: candidates.map((b) => b.blockId),
    display: lines.join("\n"),
  };
}

function buildQuarantineSummary(sessionId: string, count: number): string {
  const counts = getProvenanceCounts(sessionId);
  return `Quarantined ${count} block(s). Current: ${counts.validated} validated, ${counts.attested} attested, ${counts.legacyUnverified} unverified, ${counts.quarantined} quarantined.`;
}

// Parameters passed from index-commands.ts

export interface LegacyAttestationParams {
  /** DCP's durable state key (session file path, or cwd for in-memory sessions). */
  stateKey: string;
  /** Pi session identity and active ancestry used only for provenance binding. */
  session: ProvenanceSessionHandle;
  /** Callback to append a DCP state entry for the mutation. Calls pi.appendEntry internally. */
  appendState(reason: string): void;
}

// Main handler

/**
 * Handle a `/dcp legacy ...` command.
 * ctx.ui.notify for output, ctx.ui.confirm for interactive confirmation.
 * params.session provides session info; params.appendState records mutations.
 */
export async function handleLegacyCommand(
  args: string,
  ui: {
    notify: (msg: string) => void;
    confirm: (title: string, message: string) => Promise<boolean> | boolean;
  },
  params: LegacyAttestationParams,
): Promise<void> {
  const parsed = parseLegacyArgs(args);

  if (!parsed) {
    ui.notify(
      "Usage: /dcp legacy inspect|attest|quarantine [bN|all] [--yes]\n" +
        "  inspect  - Show blocks with their attestation status\n" +
        "  attest   - Mark legacy-unverified blocks as attested\n" +
        "  quarantine - Move legacy-unverified blocks out of active compression\n" +
        "  Example: /dcp legacy attest all --yes",
    );
    return;
  }

  const sessionId = params.stateKey;
  const { command, target, forceYes } = parsed;

  if (command === "inspect") {
    const output = buildInspectOutput(sessionId, target);
    ui.notify(output);
    return;
  }

  // Mutation commands (attest / quarantine)

  if (command === "attest") {
    const dryRun = buildAttestDryRun(sessionId, target);

    if (dryRun.blockIds.length === 0) {
      ui.notify(dryRun.display);
      return;
    }

    const proceed =
      forceYes ||
      (await Promise.resolve(ui.confirm("Legacy Attestation", dryRun.display)));

    if (!proceed) {
      ui.notify("Attestation cancelled.");
      return;
    }

    const confirmationMode = forceYes
      ? ("explicit-yes" as const)
      : ("interactive" as const);

    // Perform attestation per block
    let attestedCount = 0;
    for (const blockId of dryRun.blockIds) {
      const metadata = attestBlock(
        sessionId,
        blockId,
        "user-command",
        confirmationMode,
        params.session,
      );
      if (metadata) attestedCount++;
    }

    params.appendState(`attested ${attestedCount} block(s)`);
    ui.notify(buildAttestSummary(sessionId, attestedCount));
    return;
  }

  if (command === "quarantine") {
    const dryRun = buildQuarantineDryRun(sessionId, target);

    if (dryRun.blockIds.length === 0) {
      ui.notify(dryRun.display);
      return;
    }

    const proceed =
      forceYes ||
      (await Promise.resolve(ui.confirm("Legacy Quarantine", dryRun.display)));

    if (!proceed) {
      ui.notify("Quarantine cancelled.");
      return;
    }

    const confirmationMode = forceYes
      ? ("explicit-yes" as const)
      : ("interactive" as const);

    // Perform quarantine (persists internally in compress-state.ts)
    const quarantinedIds = quarantineLegacyBlocks(
      sessionId,
      dryRun.blockIds,
      "legacy-quarantine",
      "user-command",
      confirmationMode,
    );

    params.appendState(`quarantined ${quarantinedIds.length} block(s)`);
    ui.notify(buildQuarantineSummary(sessionId, quarantinedIds.length));
    return;
  }
}
