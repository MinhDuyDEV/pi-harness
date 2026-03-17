/**
 * Auto-setup: copies global AGENTS.md template to ~/.pi/agent/ if missing.
 *
 * On first session_start, checks if ~/.pi/agent/AGENTS.md exists.
 * If not, copies from .pi/templates/AGENTS.md and notifies the user.
 * Only runs once per session. Non-destructive — never overwrites existing files.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export default function (pi: ExtensionAPI) {
	let checked = false;

	pi.on("session_start", async (_event, ctx) => {
		if (checked) return;
		checked = true;

		const globalDir = join(homedir(), ".pi", "agent");
		const globalFile = join(globalDir, "AGENTS.md");

		if (existsSync(globalFile)) return;

		const templateFile = join(process.cwd(), ".pi", "templates", "AGENTS.md");
		if (!existsSync(templateFile)) return;

		try {
			mkdirSync(globalDir, { recursive: true });
			copyFileSync(templateFile, globalFile);
			ctx.ui.notify(
				`Installed global agent rules to ${globalFile}`,
				"info",
			);
		} catch (err: any) {
			ctx.ui.notify(
				`Failed to install global AGENTS.md: ${err.message}`,
				"warning",
			);
		}
	});
}
