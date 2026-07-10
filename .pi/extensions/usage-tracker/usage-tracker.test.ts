import { describe, it } from "node:test";
import assert from "node:assert";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import usageTrackerExtension from "../usage-tracker.js";

describe("Usage tracker extension lifecycle contract", () => {
	it("default export is a function accepting ExtensionAPI", () => {
		assert.strictEqual(typeof usageTrackerExtension, "function", "default export must be a function");
		assert.strictEqual(usageTrackerExtension.length, 1, "function should accept 1 argument (pi)");
	});

	it("registers expected lifecycle events when invoked", () => {
		const registeredEvents: string[] = [];
		const registeredCommands: string[] = [];
		const pi: ExtensionAPI = {
			on(event: string) {
				registeredEvents.push(event);
			},
			registerCommand(name: string) {
				registeredCommands.push(name);
			},
		} as unknown as ExtensionAPI;

		usageTrackerExtension(pi);

		const expectedEvents = ["input", "turn_end", "message_end", "session_shutdown"];
		for (const event of expectedEvents) {
			assert.ok(
				registeredEvents.includes(event),
				`Expected lifecycle event "${event}" to be registered, found: ${JSON.stringify(registeredEvents)}`,
			);
		}

		// Should also register the "usage" command
		assert.ok(
			registeredCommands.includes("usage"),
			`Expected "usage" command to be registered, found: ${JSON.stringify(registeredCommands)}`,
		);
	});

	it("registers exactly known events (no drift)", () => {
		const registeredEvents: string[] = [];
		const pi: ExtensionAPI = {
			on(event: string) {
				registeredEvents.push(event);
			},
			registerCommand() {},
		} as unknown as ExtensionAPI;

		usageTrackerExtension(pi);

		const knownEvents = ["input", "turn_end", "message_end", "session_shutdown"];
		for (const event of registeredEvents) {
			assert.ok(
				knownEvents.includes(event),
				`Unexpected lifecycle event registered: "${event}"`,
			);
		}
	});

	it("registers exactly the usage command (no drift)", () => {
		const registeredCommands: string[] = [];
		const pi: ExtensionAPI = {
			on() {},
			registerCommand(name: string) {
				registeredCommands.push(name);
			},
		} as unknown as ExtensionAPI;

		usageTrackerExtension(pi);

		assert.strictEqual(registeredCommands.length, 1, "Should register exactly one command");
		assert.strictEqual(registeredCommands[0], "usage", "Command should be named 'usage'");
	});
});
