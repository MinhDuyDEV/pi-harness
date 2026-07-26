import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const root = new URL("..", import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "pi-harness-phase5-packed-"));

/**
 * `PI_E2E_SIBLINGS=local` packs the sibling checkouts (building first — a
 * compiled sibling packed with `--ignore-scripts` alone would ship whatever
 * stale dist/ was on disk). This is the pre-publish mode: contract changes
 * land across the repos at once, and the gate must be runnable before any of
 * them is published. The default remains the pins in `.pi/settings.json`.
 */
function packSibling(name: string): string {
  const siblingRoot = resolve(fileURLToPath(root), "..", name);
  assert.ok(
    existsSync(join(siblingRoot, "package.json")),
    `PI_E2E_SIBLINGS=local requires a ${name} checkout next to this repo`,
  );
  execFileSync("npm", ["run", "build", "--if-present"], {
    cwd: siblingRoot,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const tarball = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", directory],
    { cwd: siblingRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim().split("\n").at(-1);
  assert.ok(tarball, `npm pack must return a tarball name for ${name}`);
  return join(directory, tarball);
}

const settings = JSON.parse(await readFile(new URL(".pi/settings.json", root), "utf8")) as {
  packages?: string[];
};
const packageSpecs = process.env.PI_E2E_SIBLINGS === "local"
  ? ["pi-core", "pi-learning", "pi-subagents", "pi-todo"].map(packSibling)
  : process.env.PI_PHASE5_PACKAGE_SPECS
    ? process.env.PI_PHASE5_PACKAGE_SPECS.split(",").filter(Boolean)
    : [
        process.env.PI_CORE_SPEC ?? "@minhduydev/pi-core@0.1.0",
        ...(settings.packages ?? [])
          .filter((entry) => /@minhduydev\/pi-(?:learning|todo|subagents)@/.test(entry))
          .map((entry) => entry.replace(/^npm:/, "")),
      ];
assert.ok(packageSpecs.length >= 3, "expected the Phase 5 package pins");

try {
  await writeFile(join(directory, "package.json"), JSON.stringify({ type: "module", private: true }), "utf8");
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...packageSpecs], {
    cwd: directory,
    stdio: "inherit",
  });
  const program = await readFile(new URL("fixtures/verify-phase5-packed-consumer.mjs", import.meta.url), "utf8");
  const programPath = join(directory, "verify.mjs");
  await writeFile(programPath, program, "utf8");
  execFileSync(join(new URL("..", import.meta.url).pathname, "node_modules", ".bin", "tsx"), [programPath], {
    cwd: directory,
    stdio: "inherit",
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
