/**
 * Packed-payload contract tests.
 *
 * Two layers:
 *  1. Pure unit tests for validatePackagePayload() with synthetic file lists —
 *     deterministic, no subprocess — proving required-present and
 *     forbidden-absent behavior including negative cases.
 *  2. One integration test that runs the real `npm pack --dry-run --json
 *     --ignore-scripts` against this repo and asserts the actual shipped
 *     payload satisfies the default contract. This is the real guard against
 *     runtime/private files (`.pi/artifacts`, `.pi/MEMORY.md`, `.pi/npm`,
 *     `.env`, credentials, generated cache) leaking into a publish.
 *  3. A closure test: every shipped script's local `./...` imports must
 *     themselves ship, so a consumer running a shipped script never hits a
 *     missing local module.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import {
  validatePackagePayload,
  defaultPayloadContract,
  normalizePackPath,
} from "../scripts/lib/package-payload.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");

const VALID_BASE = [
  "package.json",
  "README.md",
  "LICENSE",
  "AGENTS.md",
  "docs/quality-ratchet.md",
  "docs/workflow-state.md",
  "quality/aislop-debt-baseline.json",
  "skills-lock.json",
  "THIRD_PARTY_NOTICES.md",
  ".pi/settings.json",
  ".pi/APPEND_SYSTEM.md",
  ".pi/ANTI_PATTERNS.md",
  ".pi/agents/explore.md",
  ".pi/agents/implementer.md",
  ".pi/agents/peer.md",
  ".pi/agents/proof-auditor.md",
  ".pi/agents/reviewer.md",
  ".pi/agents/scout.md",
  ".pi/templates/AGENTS.md",
  ".pi/templates/adr.md",
  ".pi/templates/agent-run-report.md",
  ".pi/templates/prd.md",
  ".pi/templates/skill-config.md",
  ".pi/templates/skill-tooled.md",
  ".pi/templates/sprint-design.md",
  ".pi/templates/sprint-state.json",
  ".pi/skills/debugging-and-error-recovery/SKILL.md",
  ".pi/prompts/fix.md",
  ".pi/agents/general.md",
  ".pi/extensions/rewind/index.ts",
  ".pi/themes/harness.json",
  "scripts/init-consumer.mjs",
  "scripts/lib/package-payload.mjs",
  "scripts/lib/prompt-policy.mjs",
  "scripts/lib/quality-ratchet.mjs",
  "scripts/lib/resource-smoke.mjs",
  "scripts/lib/skill-budget.mjs",
  "scripts/lib/suite-pins.mjs",
  "scripts/registry-preflight.mjs",
  "scripts/quality-ratchet.mjs",
  "scripts/release-check.mjs",
  "scripts/smoke-packed-resources.mjs",
  "scripts/smoke-resources.mjs",
  "scripts/validate-package-payload.mjs",
  "scripts/validate-package.mjs",
  "scripts/validate-skills.mjs",
  "templates/consumer-settings.json",
  "docs/herdr-integration.md",
];

function withBase(extra: string[]): string[] {
  return [...VALID_BASE, ...extra];
}

test("settings pin portable exact package sources", () => {
  const settings = JSON.parse(readFileSync(resolve(REPO_ROOT, ".pi/settings.json"), "utf8")) as {
    packages?: string[];
  };
  // Structural, not version-literal: hard-coding versions here recreated the
  // drift this suite exists to prevent (audit H-E) — the assertion broke on
  // every legitimate pin bump and would have been "fixed" by copying whatever
  // the file said. Each sibling must be pinned via npm to one EXACT version.
  for (const name of ["pi-core", "pi-learning", "pi-subagents", "pi-todo"]) {
    const pins = (settings.packages ?? []).filter((entry) =>
      entry.includes(`@minhduydev/${name}@`),
    );
    assert.equal(pins.length, 1, `exactly one pin for ${name}`);
    assert.match(
      pins[0],
      new RegExp(`^npm:@minhduydev/${name}@\\d+\\.\\d+\\.\\d+$`),
      `${name} is pinned to an exact npm version`,
    );
  }
  const searchPins = (settings.packages ?? []).filter((entry) =>
    entry.includes("@heyhuynhgiabuu/pi-search@"),
  );
  assert.equal(searchPins.length, 1, "exactly one pin for pi-search");
  assert.match(
    searchPins[0],
    /^npm:@heyhuynhgiabuu\/pi-search@\d+\.\d+\.\d+$/,
    "pi-search is pinned to an exact npm version",
  );
  assert.equal(settings.packages?.some((entry) => entry.startsWith("local:../pi-")), false);
});

test("a payload containing every required resource and no forbidden files passes", () => {
  const { errors } = validatePackagePayload(withBase([]), defaultPayloadContract);
  assert.equal(errors.length, 0, errors.join("\n"));
});

test("a missing required exact file is reported", () => {
  const paths = withBase([]).filter((p) => p !== "skills-lock.json");
  const { errors } = validatePackagePayload(paths, defaultPayloadContract);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /skills-lock\.json/);
});

test("missing every skill SKILL.md is reported as a missing required pattern", () => {
  const paths = withBase([]).filter((p) => !p.includes("/SKILL.md"));
  const { errors } = validatePackagePayload(paths, defaultPayloadContract);
  assert.ok(errors.some((e) => /skill/i.test(e)), errors.join("\n"));
});

test("a prompt file is required", () => {
  const paths = withBase([]).filter((p) => !p.startsWith(".pi/prompts/"));
  const { errors } = validatePackagePayload(paths, defaultPayloadContract);
  assert.ok(errors.some((e) => /prompt/i.test(e)), errors.join("\n"));
});

test("a theme file is required", () => {
  const paths = withBase([]).filter((p) => !p.startsWith(".pi/themes/"));
  const { errors } = validatePackagePayload(paths, defaultPayloadContract);
  assert.ok(errors.some((e) => /theme/i.test(e)), errors.join("\n"));
});

for (const forbidden of [
  ".pi/artifacts/TODO.md",
  ".pi/MEMORY.md",
  ".pi/npm/some-runtime-output.log",
  ".env",
  "config/.env.local",
  "secrets/credentials.json",
  "deploy/credentials.yml",
  "tls/server.key",
  "node_modules/foo/index.js",
  ".git/HEAD",
  "release.tgz",
  ".DS_Store",
  "run.log",
  "coverage/lcov.info",
  ".cache/blob",
]) {
  test(`forbidden file "${forbidden}" is rejected`, () => {
    const { errors } = validatePackagePayload(withBase([forbidden]), defaultPayloadContract);
    assert.ok(
      errors.some((e) => e.includes(forbidden)),
      `expected ${forbidden} to be flagged; got: ${JSON.stringify(errors)}`,
    );
  });
}

test("legitimate source named credentials.ts is NOT rejected as a credential file", () => {
  const { errors } = validatePackagePayload(
    withBase([".pi/extensions/safety/rules/credentials.ts"]),
    defaultPayloadContract,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
});

test("tsconfig.json and types are allowed (intentionally shipped)", () => {
  const { errors } = validatePackagePayload(
    withBase(["tsconfig.json", "types/index.d.ts"]),
    defaultPayloadContract,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
});

test("normalizePackPath strips the leading package/ prefix", () => {
  assert.equal(normalizePackPath("package/.pi/settings.json"), ".pi/settings.json");
  assert.equal(normalizePackPath(".pi/settings.json"), ".pi/settings.json");
});

test("integration: real `npm pack --dry-run --json --ignore-scripts` payload is clean", () => {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    cwd: process.cwd(),
  });
  const manifest = JSON.parse(out) as { files: { path: string }[] }[];
  const paths = manifest[0].files.map((f) => f.path);
  assert.ok(paths.length > 0, "npm pack returned no files");

  const { errors } = validatePackagePayload(paths, defaultPayloadContract);
  assert.equal(
    errors.length,
    0,
    `real packed payload violates the contract:\n${errors.join("\n")}`,
  );
});

test("integration: every shipped script's local imports are themselves shipped (closure)", () => {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    cwd: process.cwd(),
  });
  const manifest = JSON.parse(out) as { files: { path: string }[] }[];
  const packed = new Set(manifest[0].files.map((f) => normalizePackPath(f.path)));
  const shippedScripts = [...packed].filter(
    (p) => p.startsWith("scripts/") && p.endsWith(".mjs"),
  );
  assert.ok(shippedScripts.length > 0, "no scripts ship");

  // Relative `./...` or `../...` imports in a shipped script must resolve to a
  // file that is itself packed, so a consumer running a shipped script never
  // hits a missing local module. Node: and bare specifiers are out of scope.
  const localImportRe = /(?:import|from)\s+["'](\.{1,2}\/[^"']+)["']/g;
  const missing: string[] = [];
  for (const script of shippedScripts) {
    const content = readFileSync(script, "utf8");
    for (const m of content.matchAll(localImportRe)) {
      const spec = m[1];
      const abs = resolve(process.cwd(), dirname(script), spec);
      const rel = relative(process.cwd(), abs);
      // Only enforce when the resolved file exists in the source tree (skip
      // extensionless specifiers that Node resolves at runtime to .mjs/.ts).
      if (existsSync(abs) && !packed.has(rel) && !packed.has(normalizePackPath(rel))) {
        missing.push(`${script} imports ${spec} -> ${rel} (not shipped)`);
      }
    }
  }
  assert.equal(
    missing.length,
    0,
    `shipped scripts import local modules that are not shipped:\n${missing.join("\n")}`,
  );
});
test("package metadata follows Pi's portable package conventions", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(manifest.private, false);
  assert.ok(manifest.keywords?.includes("pi-package"));
  for (const name of [
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
  ]) {
    // One bounded range across the pi-* suite (audit X-C): "*" protected
    // nothing — a Pi 0.82 host would have satisfied it while the code was
    // only ever verified against 0.81.x.
    assert.equal(
      manifest.peerDependencies?.[name],
      ">=0.81.1 <0.82.0",
      `${name} must pin the verified Pi host range`,
    );
  }
  assert.equal(manifest.scripts?.prepublishOnly, "npm run release:check:registry");
  assert.equal(manifest.scripts?.["release:check"], "npm run release:check:local");
  assert.match(manifest.scripts?.["pack:check"] ?? "", /validate:package-payload/);
});

test("source reproducibility files are tracked even though npm excludes them from tarballs", () => {
  const tracked = new Set(
    execFileSync("git", ["ls-files", ".gitignore", "package-lock.json"], {
      encoding: "utf8",
      cwd: process.cwd(),
    })
      .split("\n")
      .filter(Boolean),
  );

  assert.deepEqual(tracked, new Set([".gitignore", "package-lock.json"]));
});
