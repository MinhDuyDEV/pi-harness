import { describe, it } from "node:test";
import assert from "node:assert";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import diagnosticsExtension from "./extension.ts";

describe("Diagnostics extension lifecycle contract", () => {
	it("default export is a function accepting ExtensionAPI", () => {
		assert.strictEqual(typeof diagnosticsExtension, "function", "default export must be a function");
		assert.strictEqual(diagnosticsExtension.length, 1, "function should accept 1 argument (pi)");
	});

	it("registers diagnostics tool and lifecycle events", () => {
		const registeredTools: Array<{ name: string; label: string }> = [];
		const registeredEvents: string[] = [];

		const pi: ExtensionAPI = {
			registerTool(defn: { name: string; label: string }) {
				registeredTools.push({ name: defn.name, label: defn.label });
			},
			on(event: string) {
				registeredEvents.push(event);
			},
		} as unknown as ExtensionAPI;

		diagnosticsExtension(pi);

		// Verify tool registration
		const diagTool = registeredTools.find((t) => t.name === "diagnostics");
		assert.ok(diagTool, "Expected 'diagnostics' tool to be registered");
	});

	it("registers expected event handlers for activation", () => {
		const registeredEvents: string[] = [];
		const pi: ExtensionAPI = {
			registerTool() {},
			on(event: string) {
				registeredEvents.push(event);
			},
		} as unknown as ExtensionAPI;

		diagnosticsExtension(pi);

		const expectedEvents = ["tool_result"];
		for (const event of expectedEvents) {
			assert.ok(
				registeredEvents.includes(event),
				`Expected lifecycle event "${event}" to be registered, found: ${JSON.stringify(registeredEvents)}`,
			);
		}
	});

	it("registers exactly known events (no drift)", () => {
		const registeredEvents: string[] = [];
		const pi: ExtensionAPI = {
			registerTool() {},
			on(event: string) {
				registeredEvents.push(event);
			},
		} as unknown as ExtensionAPI;

		diagnosticsExtension(pi);

		const knownEvents = ["tool_result"];
		for (const event of registeredEvents) {
			assert.ok(
				knownEvents.includes(event),
				`Unexpected lifecycle event registered: "${event}"`,
			);
		}
	});
});
