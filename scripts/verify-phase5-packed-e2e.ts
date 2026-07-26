import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url);
const settings = JSON.parse(await readFile(new URL(".pi/settings.json", root), "utf8")) as {
  packages?: string[];
};
const packageSpecs = process.env.PI_PHASE5_PACKAGE_SPECS
  ? process.env.PI_PHASE5_PACKAGE_SPECS.split(",").filter(Boolean)
  : (settings.packages ?? [])
      .filter((entry) => /@minhduydev\/pi-(?:learning|todo|subagents)@/.test(entry))
      .map((entry) => entry.replace(/^npm:/, ""));
assert.equal(packageSpecs.length, 3, "expected exact Phase 5 package pins");

const directory = await mkdtemp(join(tmpdir(), "pi-harness-phase5-packed-"));
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
