import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { checkRegistryPins, renderRegistryReport } from "../scripts/registry-preflight.mjs";
import { parseSuitePins, SUITE_PUBLISH_ORDER } from "../scripts/lib/suite-pins.mjs";
import { releaseEnvironment } from "../scripts/release-check.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const SETTINGS = JSON.parse(readFileSync(resolve(ROOT, ".pi/settings.json"), "utf8"));

test("suite pins have one exact registry version for every dependency", () => {
  const pins = parseSuitePins(SETTINGS);
  assert.deepEqual(Object.keys(pins), [
    "@minhduydev/pi-core",
    "@minhduydev/pi-subagents",
    "@minhduydev/pi-learning",
    "@minhduydev/pi-todo",
  ]);
  for (const pin of Object.values(pins)) {
    assert.match(pin.spec, /^@minhduydev\/pi-[a-z-]+@\d+\.\d+\.\d+$/);
  }
});

test("suite pin parser rejects a missing or duplicate dependency", () => {
  assert.throws(() => parseSuitePins({ packages: SETTINGS.packages.slice(1) }), /pi-core/);
  assert.throws(
    () => parseSuitePins({ packages: [...SETTINGS.packages, SETTINGS.packages[0]] }),
    /duplicate/,
  );
});

test("registry preflight identifies exact unpublished pins and prints publish order", () => {
  const pins = parseSuitePins(SETTINGS);
  const results = checkRegistryPins(pins, (_command: string, args: string[]) => {
    const expected = Object.values(pins).find((pin) => pin.spec === args[1])?.version;
    return {
      status: args[1]?.includes("pi-core") ? 1 : 0,
      stdout: args[1]?.includes("pi-core") ? "" : JSON.stringify(expected),
      stderr: args[1]?.includes("pi-core") ? "npm error E404" : "",
    };
  });
  assert.equal(results.filter((result) => !result.available).length, 1);
  const report = renderRegistryReport(results);
  assert.match(report, new RegExp(pins["@minhduydev/pi-core"].spec.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(report, /E404/);
  assert.match(report, new RegExp(SUITE_PUBLISH_ORDER.join(" → ").replaceAll("/", "\\/")));
});

test("registry preflight does not misreport network errors or wrong versions as unpublished", () => {
  const pins = parseSuitePins(SETTINGS);
  const mismatch = checkRegistryPins(pins, () => ({
    status: 0,
    stdout: '"99.0.0"',
    stderr: "",
  }));
  assert.ok(mismatch.every((result) => result.status === "mismatch"));
  assert.match(renderRegistryReport(mismatch), /not classified as unpublished packages/);
  assert.doesNotMatch(renderRegistryReport(mismatch), /Missing now:/);

  const network = checkRegistryPins(pins, () => ({
    status: 1,
    stdout: "",
    stderr: "npm error ENETUNREACH",
  }));
  assert.ok(network.every((result) => result.status === "error"));
  assert.match(renderRegistryReport(network), /lookup errors/);
});

test("release gate refuses an ambiguous mode before running any checks", () => {
  const result = spawnSync(process.execPath, [resolve(ROOT, "scripts/release-check.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--mode=local or --mode=registry/);
});

test("release modes cannot inherit developer E2E overrides", () => {
  const poisoned = {
    PATH: process.env.PATH,
    PI_E2E_SIBLINGS: "local",
    PI_CORE_SPEC: "/tmp/forged-core.tgz",
    PI_LEARNING_SPEC: "/tmp/forged-learning.tgz",
    PI_SUBAGENTS_SPEC: "/tmp/forged-subagents.tgz",
    PI_TODO_SPEC: "/tmp/forged-todo.tgz",
    PI_PHASE5_PACKAGE_SPECS: "/tmp/forged-all.tgz",
  };
  const registry = releaseEnvironment("registry", poisoned);
  for (const key of Object.keys(poisoned).filter((key) => key.startsWith("PI_"))) {
    assert.equal(registry[key], undefined, `registry mode must sanitize ${key}`);
  }
  const local = releaseEnvironment("local", poisoned);
  assert.equal(local.PI_E2E_SIBLINGS, "local");
  for (const key of Object.keys(poisoned).filter(
    (key) => key.startsWith("PI_") && key !== "PI_E2E_SIBLINGS",
  )) {
    assert.equal(local[key], undefined, `local mode must sanitize ${key}`);
  }
});

test("cross-package workflow reports branch source and exact sibling SHAs", () => {
  const workflow = readFileSync(resolve(ROOT, ".github/workflows/integration.yml"), "utf8");
  assert.match(workflow, /git ls-remote --exit-code --heads/);
  assert.match(workflow, /sibling-manifest\.tsv/);
  assert.match(workflow, /git -C "\$repo" rev-parse HEAD/);
  assert.doesNotMatch(workflow, /if ! git clone --depth 1 --branch/);
});

test("release documentation pins the owner-controlled order and both gate modes", () => {
  const docs = readFileSync(resolve(ROOT, "README.md"), "utf8");
  assert.match(docs, /release:check:local/);
  assert.match(docs, /release:check:registry/);
  let cursor = -1;
  for (const name of SUITE_PUBLISH_ORDER) {
    const next = docs.indexOf(name, cursor + 1);
    assert.ok(next > cursor, `${name} must appear in publish order`);
    cursor = next;
  }
  const releaseScript = readFileSync(resolve(ROOT, "scripts/release-check.mjs"), "utf8");
  assert.doesNotMatch(releaseScript, /["']publish["']/);
});
