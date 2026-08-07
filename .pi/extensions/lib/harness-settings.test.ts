/**
 * Binds the harness settings reader and the per-extension gates.
 *
 * Binds the harness settings reader and shipped per-extension gates. The
 * prompt-shaping keys (superpi, gptPersonality) keep their original shape.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import checkpoint from "../checkpoint/index.js";
import dcp from "../dcp/index.js";
import learningCoordinator from "../learning-coordinator/index.js";
import rewind from "../rewind/index.js";
import shortcutContinue from "../shortcut-continue.js";
import tps from "../tps.js";
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

test("readExtensionGate: settings can turn a gate on or explicitly off", () => {
  inProject(
    { "pi-harness": { extensions: { dcp: true, checkpoint: false } } },
    (cwd) => {
      assert.equal(readExtensionGate(cwd, "dcp", false), true);
      assert.equal(readExtensionGate(cwd, "checkpoint", true), false);
    },
  );
});

test("readExtensionGate: malformed values do not override a profile", () => {
  inProject({ "pi-harness": { profile: "full", extensions: { dcp: "on" } } }, (cwd) => {
    assert.equal(readExtensionGate(cwd, "dcp", false), true);
  });
});

test("readExtensionGate: accepts already-parsed settings as the source", () => {
  assert.equal(readExtensionGate({ extensions: { dcp: true } }, "dcp", false), true);
  assert.equal(readExtensionGate({ extensions: {} }, "dcp", false), false);
  assert.equal(readExtensionGate({}, "dcp", true), true);
});

test("the full profile provides the shipped consumer extension bundle", () => {
  assert.equal(readExtensionGate({ profile: "full" }, "safety", false), true);
  assert.equal(readExtensionGate({ profile: "full" }, "dcp", false), true);
  assert.equal(readExtensionGate({ profile: "full" }, "continueAfterCompaction", false), true);
  assert.equal(readExtensionGate({ profile: "full" }, "checkpoint", false), true);
  assert.equal(readExtensionGate({ profile: "full" }, "workflowState", false), true);
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
    assert.equal(readExtensionGate({ extensions: { rewind: true } }, "rewind", true), false);
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

/** Extension entries read their gate from process.cwd() at call time. */
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
