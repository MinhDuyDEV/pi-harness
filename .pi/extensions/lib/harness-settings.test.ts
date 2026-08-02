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
import checkpoint from "../checkpoint/index.js";
import dcp from "../dcp/index.js";
import learningCoordinator from "../learning-coordinator/index.js";
import rewind from "../rewind/index.js";
import shortcutContinue from "../shortcut-continue.js";
import tps from "../tps.js";
import tui from "../tui/index.js";
import workflowState from "../workflow-state/index.js";
import {
  promptShapingAllowed,
  readExtensionGate,
  readHarnessSeatRole,
  readHarnessSettings,
} from "./harness-settings.js";

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

test("readExtensionGate: providers remain opt-in when a malformed value would otherwise inherit true", () => {
  inProject({ "pi-harness": { extensions: { deepseek: "on", mimo: 1 } } }, (cwd) => {
    assert.equal(readExtensionGate(cwd, "deepseek", false), false);
    assert.equal(readExtensionGate(cwd, "mimo", true), false);
  });
});

test("readExtensionGate: accepts already-parsed settings as the source", () => {
  assert.equal(readExtensionGate({ extensions: { xai: true } }, "xai", false), true);
  assert.equal(readExtensionGate({ extensions: {} }, "xai", false), false);
  assert.equal(readExtensionGate({}, "xai", true), false);
});

test("the full profile provides the consumer extension bundle without enabling providers", () => {
  assert.equal(readExtensionGate({ profile: "full" }, "safety", false), true);
  assert.equal(readExtensionGate({ profile: "full" }, "dcp", false), true);
  assert.equal(readExtensionGate({ profile: "full" }, "checkpoint", false), true);
  assert.equal(readExtensionGate({ profile: "full" }, "workflowState", false), true);
  assert.equal(readExtensionGate({ profile: "full" }, "tui", false), true);
  assert.equal(readExtensionGate({ profile: "full" }, "deepseek", true), false);
  assert.equal(
    readExtensionGate({ profile: "full", extensions: { dcp: true } }, "dcp", false),
    true,
    "an explicit per-key setting overrides the profile",
  );
});

test("worker seat mode disables prompt shaping and all write-heavy extensions", () => {
  const previous = process.env.PI_HARNESS_SEAT_ROLE;
  try {
    process.env.PI_HARNESS_SEAT_ROLE = "implementer";
    assert.equal(readHarnessSeatRole(), "implementer");
    assert.equal(promptShapingAllowed(), false);
    assert.equal(readExtensionGate({ profile: "full" }, "dcp", true), false);
    assert.equal(readExtensionGate({ extensions: { tui: true } }, "tui", true), false);
    assert.equal(readExtensionGate({ profile: "full" }, "safety", false), true);
    assert.equal(readExtensionGate({ profile: "full" }, "herdrState", false), true);

    process.env.PI_HARNESS_SEAT_ROLE = "typo";
    assert.equal(readHarnessSeatRole(), "unknown");
    assert.equal(readExtensionGate({ profile: "full" }, "checkpoint", true), false);
  } finally {
    if (previous === undefined) delete process.env.PI_HARNESS_SEAT_ROLE;
    else process.env.PI_HARNESS_SEAT_ROLE = previous;
  }
});

test("profile-gated entries return before touching disabled extension APIs", () => {
  inProjectCwd(
    {
      "pi-harness": {
        profile: "full",
        extensions: {
          checkpoint: false,
          dcp: false,
          learningCoordinator: false,
          rewind: false,
          shortcutContinue: false,
          tps: false,
          tui: false,
          workflowState: false,
        },
      },
    },
    () => {
    for (const entry of [
      checkpoint,
      dcp,
      learningCoordinator,
      rewind,
      shortcutContinue,
      tps,
      tui,
      workflowState,
    ]) {
      const accesses: PropertyKey[] = [];
      const disabledPi = new Proxy(
        {},
        {
          get(_target, property) {
            accesses.push(property);
            throw new Error(`disabled extension touched pi.${String(property)}`);
          },
        },
      ) as ExtensionAPI;
      assert.doesNotThrow(() => entry(disabledPi as never));
      assert.deepEqual(accesses, []);
    }
  });
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
