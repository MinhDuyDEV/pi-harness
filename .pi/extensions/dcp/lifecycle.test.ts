import { describe, it } from "node:test";
import assert from "node:assert";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import dcpExtension from "./index.ts";
import { handleSessionBeforeCompact } from "./index-compact-handler.ts";

describe("DCP extension lifecycle contract", () => {
	it("exports dcpExtension accepting ExtensionAPI", () => {
		assert.strictEqual(typeof dcpExtension, "function", "dcpExtension must be a function");
		assert.strictEqual(dcpExtension.length, 1, "dcpExtension should accept 1 argument (pi)");
	});

	it("handleSessionBeforeCompact is a function", () => {
		assert.strictEqual(typeof handleSessionBeforeCompact, "function");
	});

	it("dcpExtension registers expected lifecycle events when invoked", () => {
		const registered: string[] = [];
		const pi: ExtensionAPI = {
			// Called by dcpExtension for each event
			on(event: string) {
				registered.push(event);
			},
		} as unknown as ExtensionAPI;

		dcpExtension(pi);

		// Core lifecycle events the DCP extension is expected to register
		const expectedEvents = [
			"session_start",
			"input",
			"tool_result",
			"turn_end",
			"before_agent_start",
			"context",
			"session_before_compact",
			"session_compact",
			"session_before_tree",
			"session_tree",
			"session_shutdown",
		];

		for (const event of expectedEvents) {
			assert.ok(
				registered.includes(event),
				`Expected lifecycle event "${event}" to be registered, found: ${JSON.stringify(registered)}`,
			);
		}
	});

	it("does not register unknown lifecycle events", () => {
		const registered: string[] = [];
		const pi: ExtensionAPI = {
			on(event: string) {
				registered.push(event);
			},
		} as unknown as ExtensionAPI;

		dcpExtension(pi);

		const knownEvents = [
			"session_start",
			"input",
			"tool_result",
			"turn_end",
			"before_agent_start",
			"context",
			"session_before_compact",
			"session_compact",
			"session_before_tree",
			"session_tree",
			"session_shutdown",
		];

		for (const event of registered) {
			assert.ok(
				knownEvents.includes(event),
				`Unexpected lifecycle event registered: "${event}"`,
			);
		}
	});
});
