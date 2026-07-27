/**
 * Binds the harness settings reader and the per-extension gates.
 *
 * Provider extensions (deepseek, mimo, xai) are opt-in: a consumer who
 * installs the harness must not get third-party model providers registered
 * until their settings.json says so. The prompt-shaping keys (superpi,
 * gptPersonality) keep their original shape — these tests pin both.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import deepseekProvider from "../deepseek-provider.js";
import mimoProvider from "../mimo-provider.js";
import xaiOauth from "../xai-oauth.js";
import { readExtensionGate, readHarnessSettings } from "./harness-settings.js";

function projectWithSettings(settings: unknown): string {
  const cwd = mkdtempSync(join(tmpdir(), "harness-settings-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify(settings), "utf8");
  return cwd;
}

function inProject(settings: unknown, body: (cwd: string) => void): void {
  const cwd = projectWithSettings(settings);
  try {
    body(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("readHarnessSettings: superpi/gptPersonality parse exactly as before", () => {
  inProject({ "pi-harness": { superpi: true, gptPersonality: false } }, (cwd) => {
    assert.deepEqual(readHarnessSettings(cwd), { superpi: true, gptPersonality: false });
  });
  // Non-boolean values and unknown keys are dropped, not coerced.
  inProject({ "pi-harness": { superpi: "yes", other: 1 } }, (cwd) => {
    assert.deepEqual(readHarnessSettings(cwd), {});
  });
  // Missing settings file / missing block stay empty.
  inProject({}, (cwd) => {
    assert.deepEqual(readHarnessSettings(cwd), {});
  });
  const empty = mkdtempSync(join(tmpdir(), "no-settings-"));
  try {
    assert.deepEqual(readHarnessSettings(empty), {});
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("readExtensionGate: provider keys default to FALSE when not configured", () => {
  inProject({ "pi-harness": { superpi: true } }, (cwd) => {
    for (const key of ["deepseek", "mimo", "xai"]) {
      assert.equal(readExtensionGate(cwd, key, false), false, key);
    }
  });
  inProject({}, (cwd) => {
    assert.equal(readExtensionGate(cwd, "deepseek", false), false);
  });
});

test("readExtensionGate: settings can turn a gate on or explicitly off", () => {
  inProject(
    { "pi-harness": { extensions: { deepseek: true, mimo: false, xai: true } } },
    (cwd) => {
      assert.equal(readExtensionGate(cwd, "deepseek", false), true);
      assert.equal(readExtensionGate(cwd, "mimo", false), false);
      assert.equal(readExtensionGate(cwd, "xai", false), true);
    },
  );
});

test("readExtensionGate: non-boolean gate values fall back to the default", () => {
  inProject({ "pi-harness": { extensions: { deepseek: "on", mimo: 1 } } }, (cwd) => {
    assert.equal(readExtensionGate(cwd, "deepseek", false), false);
    assert.equal(readExtensionGate(cwd, "mimo", true), true);
  });
});

test("readExtensionGate: accepts already-parsed settings as the source", () => {
  assert.equal(readExtensionGate({ extensions: { xai: true } }, "xai", false), true);
  assert.equal(readExtensionGate({ extensions: {} }, "xai", false), false);
  assert.equal(readExtensionGate({}, "xai", true), true);
});

// --- Entry-level: the three provider extensions honor the gate ---

interface Recorded {
  providers: string[];
  tools: string[];
}

function recordingPi(): { pi: ExtensionAPI; recorded: Recorded } {
  const recorded: Recorded = { providers: [], tools: [] };
  const pi = {
    registerProvider(name: string) {
      recorded.providers.push(name);
    },
    registerTool(tool: { name: string }) {
      recorded.tools.push(tool.name);
    },
  } as unknown as ExtensionAPI;
  return { pi, recorded };
}

/** The provider entries read the gate from process.cwd() at call time. */
function inProjectCwd(settings: unknown, body: () => void): void {
  const previous = process.cwd();
  const cwd = projectWithSettings(settings);
  try {
    process.chdir(cwd);
    body();
  } finally {
    process.chdir(previous);
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("provider entries register nothing when the gate is off (the default)", () => {
  inProjectCwd({ "pi-harness": { superpi: true } }, () => {
    for (const entry of [deepseekProvider, mimoProvider, xaiOauth]) {
      const { pi, recorded } = recordingPi();
      entry(pi as never);
      assert.deepEqual(recorded, { providers: [], tools: [] });
    }
  });
});

test("provider entries register their provider when the gate is on", () => {
  inProjectCwd(
    { "pi-harness": { extensions: { deepseek: true, mimo: true, xai: true } } },
    () => {
      const deepseek = recordingPi();
      deepseekProvider(deepseek.pi as never);
      assert.deepEqual(deepseek.recorded.providers, ["deepseek"]);

      const mimo = recordingPi();
      mimoProvider(mimo.pi);
      assert.deepEqual(mimo.recorded.providers, ["xiaomi-mimo"]);

      const xai = recordingPi();
      xaiOauth(xai.pi);
      assert.deepEqual(xai.recorded.providers, ["xai-auth"]);
    },
  );
});

test("each provider gate is independent", () => {
  inProjectCwd({ "pi-harness": { extensions: { mimo: true } } }, () => {
    const { pi, recorded } = recordingPi();
    deepseekProvider(pi as never);
    mimoProvider(pi);
    xaiOauth(pi);
    assert.deepEqual(recorded.providers, ["xiaomi-mimo"]);
  });
});
