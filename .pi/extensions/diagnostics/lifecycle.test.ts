import { describe, it } from "node:test";
import assert from "node:assert";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import diagnosticsExtension from "./extension.ts";
import {
  autoFallowEnabled,
  autoFallowTimeoutMs,
  fallowAvailable,
  fallowHasFindings,
  isAutoDiagnosticPath,
} from "./auto-inject.ts";
import { renderDiagnosticsCall } from "./tool-render.ts";

const plainTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

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

	it("renders the prefixed diagnostics tool-call title", () => {
		const lines = renderDiagnosticsCall(undefined, plainTheme as never)
			.render(80)
			.map((line) => line.trimEnd());

		assert.deepStrictEqual(lines, ["⚙ diagnostics"]);
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

describe("Auto-fallow gate", () => {
  it("is enabled by default and only literal false disables it", () => {
    const previous = process.env.PI_DIAGNOSTICS_AUTO_FALLOW;
    delete process.env.PI_DIAGNOSTICS_AUTO_FALLOW;
    try {
      assert.equal(autoFallowEnabled(), true);
      process.env.PI_DIAGNOSTICS_AUTO_FALLOW = "false";
      assert.equal(autoFallowEnabled(), false);
      process.env.PI_DIAGNOSTICS_AUTO_FALLOW = "true";
      assert.equal(autoFallowEnabled(), true);
    } finally {
      if (previous === undefined) delete process.env.PI_DIAGNOSTICS_AUTO_FALLOW;
      else process.env.PI_DIAGNOSTICS_AUTO_FALLOW = previous;
    }
  });

  it("caps the auto-fallow timeout and project path boundary", () => {
    const previous = process.env.PI_DIAGNOSTICS_AUTO_FALLOW_TIMEOUT_MS;
    try {
      process.env.PI_DIAGNOSTICS_AUTO_FALLOW_TIMEOUT_MS = "999999";
      assert.equal(autoFallowTimeoutMs(), 30_000);
      process.env.PI_DIAGNOSTICS_AUTO_FALLOW_TIMEOUT_MS = "10";
      assert.equal(autoFallowTimeoutMs(), 1_000);
      assert.equal(isAutoDiagnosticPath("/repo", "/repo", "src/a.ts"), true);
      assert.equal(isAutoDiagnosticPath("/repo", "/repo", "/other/a.ts"), false);
      assert.equal(isAutoDiagnosticPath("/repo", "/repo", "../other/a.ts"), false);
    } finally {
      if (previous === undefined) delete process.env.PI_DIAGNOSTICS_AUTO_FALLOW_TIMEOUT_MS;
      else process.env.PI_DIAGNOSTICS_AUTO_FALLOW_TIMEOUT_MS = previous;
    }
  });

  it("stays silent on clean metadata and recognizes configured Fallow", () => {
    const previous = process.env.FALLOW_BIN;
    process.env.FALLOW_BIN = "/local/fallow";
    try {
      assert.equal(fallowAvailable(), true);
      assert.equal(fallowHasFindings(undefined), false);
      assert.equal(fallowHasFindings({ ok: true } as never), false);
      assert.equal(fallowHasFindings({ ok: false } as never), true);
    } finally {
      if (previous === undefined) delete process.env.FALLOW_BIN;
      else process.env.FALLOW_BIN = previous;
    }
  });
});
