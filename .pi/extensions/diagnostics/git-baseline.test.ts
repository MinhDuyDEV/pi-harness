import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runFallowAnalysis } from "./fallow.js";
import { selectChangedSince } from "./git-baseline.js";

describe("diagnostics changed baseline", () => {
  it("chooses the first verified automatic baseline", async () => {
    const checked: string[] = [];
    const result = await selectChangedSince("auto", async (ref) => {
      checked.push(ref);
      return ref === "main";
    });

    assert.deepEqual(checked, ["@{upstream}", "origin/HEAD", "main"]);
    assert.deepEqual(result, { ok: true, ref: "main", source: "auto" });
  });

  it("fails visibly for an invalid explicit baseline", async () => {
    const result = await selectChangedSince("missing-branch", async () => false);

    assert.deepEqual(result, {
      ok: false,
      requested: "missing-branch",
      reason: "Git baseline does not resolve to a commit",
    });
  });

  it("does not compare HEAD to itself when no automatic baseline exists", async () => {
    const checked: string[] = [];
    const result = await selectChangedSince("auto", async (ref) => {
      checked.push(ref);
      return false;
    });

    assert.deepEqual(checked, ["@{upstream}", "origin/HEAD", "main", "master", "HEAD~1"]);
    assert.deepEqual(result, {
      ok: false,
      requested: "auto",
      reason: "No automatic Git baseline resolves to a commit",
    });
  });

  it("rejects option-like, control, and oversized refs before invoking git", async () => {
    let calls = 0;
    const verify = async () => { calls += 1; return true; };

    for (const ref of ["--help", "main\nHEAD", "x".repeat(201)]) {
      const result = await selectChangedSince(ref, verify);
      assert.equal(result.ok, false);
    }
    assert.equal(calls, 0);
  });

  it("returns an honest diagnostic failure before invoking Fallow", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-diagnostics-baseline-"));
    try {
      await writeFile(path.join(root, "tsconfig.json"), "{}\n", "utf8");
      const result = await runFallowAnalysis(root, "changed", "missing-branch");

      assert.ok(result);
      assert.equal(result.meta.ok, false);
      assert.equal(result.meta.exitCode, 2);
      assert.match(result.text, /Baseline error/);
      assert.match(result.text, /missing-branch/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
