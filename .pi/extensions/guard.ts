import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Guard extension — blocks dangerous patterns before execution.
 *
 * 1. Conventional Commits: rejects `git commit` with non-compliant messages.
 * 2. Pipe-to-shell:        rejects `curl … | bash` and variants.
 */
export default function (pi: ExtensionAPI) {
  const CONVENTIONAL_RE =
    /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))?!?: .+/;

  pi.on("tool_call", async (event, _ctx) => {
    if (event.toolName !== "bash") return;

    const input = event.input as { command?: string } | undefined;
    const cmd: string = input?.command ?? "";

    // --- curl | bash blocker ---
    if (/curl\s.*\|\s*(?:ba)?sh/i.test(cmd) || /wget\s.*\|\s*(?:ba)?sh/i.test(cmd)) {
      return {
        block: true,
        reason: "Blocked: detected pipe-to-shell pattern (curl/wget | bash). Download first, inspect, then run.",
      };
    }

    // --- conventional commit enforcer ---
    const commitMatch = cmd.match(/git\s+commit\s/);
    if (!commitMatch) return;

    // Extract message from -m "..." or --message="..."
    const msgMatch =
      cmd.match(/(?:-m|--message=?)\s*"([^"]*)"/) ??
      cmd.match(/(?:-m|--message=?)\s*'([^']*)'/) ??
      cmd.match(/(?:-m|--message=?)\s+(\S+)/);

    const msg = msgMatch?.[1];

    if (!msg) {
      return {
        block: true,
        reason: "Blocked: git commit missing -m message. Use: git commit -m \"type(scope): subject\"",
      };
    }

    if (!CONVENTIONAL_RE.test(msg)) {
      return {
        block: true,
        reason: [
          "Blocked: commit message is not Conventional Commits compliant.",
          `Got: ${msg}`,
          "Expected: <type>(scope): <subject>",
          "Types: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert",
        ].join("\n"),
      };
    }
  });
}
