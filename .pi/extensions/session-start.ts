import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Session start extension — logs session lifecycle events.
 * Uses 0.65.0 session_start event.reason field.
 */
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (event, ctx) => {
    const reason = event.reason; // "startup" | "reload" | "new" | "resume" | "fork"
    const sessionFile = ctx.sessionManager.getSessionFile() ?? "ephemeral";
    const previous = event.previousSessionFile;

    const lines = [`Session ${reason}: ${sessionFile}`];
    if (previous) lines.push(`Previous: ${previous}`);

    ctx.ui.notify(lines.join("\n"), "info");
  });
}
