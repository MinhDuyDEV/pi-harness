import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";

export interface TruncateResult {
  content: string;
  truncated: boolean;
  fullOutputPath?: string;
  outputLines: number;
  totalLines: number;
}

export async function truncateForAgent(rawText: string, label: string): Promise<TruncateResult> {
  const truncation = truncateHead(rawText, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  let fullOutputPath: string | undefined;
  if (truncation.truncated) {
    const tempDir = await mkdtemp(join(tmpdir(), "pi-diagnostics-"));
    fullOutputPath = join(tempDir, `${label.replace(/[^a-z0-9]+/gi, "-")}.txt`);
    await withFileMutationQueue(fullOutputPath, async () =>
      writeFile(fullOutputPath!, rawText, "utf8"),
    );
  }

  const notice =
    truncation.truncated && fullOutputPath
      ? `\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output: ${fullOutputPath}]`
      : "";

  return {
    content: truncation.content + notice,
    truncated: truncation.truncated,
    fullOutputPath,
    outputLines: truncation.outputLines,
    totalLines: truncation.totalLines,
  };
}