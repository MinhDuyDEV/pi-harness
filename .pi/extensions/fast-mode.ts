/**
 * Fast Mode Extension
 *
 * Adds a `/fast` command that toggles OpenAI's priority service tier.
 * When enabled, injects `service_tier: "priority"` into outgoing
 * OpenAI Responses API requests via pi's `before_provider_request` hook.
 *
 * This uses pi-ai's native service_tier support — priority tier is
 * documented as ~1.5× faster at 2× cost. The cost multiplier is already
 * handled by pi-ai's built-in pricing logic.
 *
 * Supports: OpenAI direct, GitHub Copilot (OpenAI-routed models), and
 * any provider using the openai-responses API type.
 *
 * State persists across sessions in ~/.config/pi/fast-mode.json.
 * Toggle with `/fast`, or use `/fast on|off|status|flex`.
 *
 * Inspired by: Tarquinen/opencodex-fast (OpenCode plugin)
 * Ported to pi's native extension API — no fetch monkey-patching.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ServiceTier = "auto" | "priority" | "flex";

interface FastModeState {
	enabled: boolean;
	tier: ServiceTier;
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

const STATE_PATH = join(
	process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
	"pi",
	"fast-mode.json",
);

function writeState(state: FastModeState): void {
	const dir = dirname(STATE_PATH);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const tmp = `${STATE_PATH}.tmp`;
	writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
	renameSync(tmp, STATE_PATH);
}

function readState(): FastModeState {
	try {
		if (!existsSync(STATE_PATH)) return { enabled: false, tier: "priority" };
		const raw = readFileSync(STATE_PATH, "utf8");
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return { enabled: false, tier: "priority" };
		return {
			enabled: parsed.enabled === true,
			tier: (parsed.tier === "flex" || parsed.tier === "priority") ? parsed.tier : "priority",
		};
	} catch {
		return { enabled: false, tier: "priority" };
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function fastModeExtension(pi: any): void {
	let state = readState();

	// ── /fast command ─────────────────────────────────────────

	pi.registerCommand("fast", {
		description: "Toggle priority/flex service tier for OpenAI requests",

		getArgumentCompletions(prefix: string) {
			const opts = ["on", "off", "status", "flex", "priority"];
			return opts
				.filter((o) => o.startsWith(prefix.toLowerCase()))
				.map((v) => ({ value: v, label: v }));
		},

		async handler(args: string, ctx: any) {
			const arg = args?.trim().toLowerCase();

			if (arg === "on") {
				state.enabled = true;
			} else if (arg === "off") {
				state.enabled = false;
			} else if (arg === "status") {
				// no state change — just report
			} else if (arg === "flex") {
				state.tier = "flex";
				state.enabled = true;
			} else if (arg === "priority") {
				state.tier = "priority";
				state.enabled = true;
			} else {
				// bare /fast → toggle
				state.enabled = !state.enabled;
			}

			if (arg !== "status") {
				writeState(state);
			}

			const tierLabel = state.tier === "flex" ? "flex (0.5× cost, slower)" : "priority (2× cost, ~1.5× faster)";
			const statusLine = state.enabled
				? `⚡ Fast mode **ON** — tier: ${tierLabel}`
				: `Fast mode **OFF** — requests use default tier`;

			const lines = [
				statusLine,
				"",
				"Usage: `/fast [on|off|status|flex|priority]`",
				"Applies to OpenAI Responses API requests only.",
			];

			const output = lines.join("\n");
			if (ctx?.ui) {
				ctx.ui.notify(output, state.enabled ? "warning" : "info");
			}
			return output;
		},
	});

	// ── Request interception ──────────────────────────────────

	pi.on("before_provider_request", (event: any) => {
		if (!state.enabled) return;

		const payload = event?.payload;
		if (!payload || typeof payload !== "object") return;

		// Only inject if the payload looks like an OpenAI Responses API request.
		// OpenAI Responses API has `model` + `input` fields.
		// Anthropic has `model` + `messages` fields.
		// We only touch OpenAI-shaped payloads.
		if (!("input" in payload) || !("model" in payload)) return;

		// Don't override if already explicitly set
		if (payload.service_tier !== undefined) return;

		return {
			...payload,
			service_tier: state.tier,
		};
	});
}
