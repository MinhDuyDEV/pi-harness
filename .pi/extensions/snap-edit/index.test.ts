import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import snapEditExtension from "./index.ts";

/** A minimal recorded tool definition captured by the stub API. */
interface RecordedTool {
  name: string;
  inputSchema: unknown;
  // Upstream registers execute as an async function bound on the definition.
  execute: (...args: unknown[]) => Promise<unknown>;
  [key: string]: unknown;
}

type EventHandler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;

/** Stub ExtensionAPI that records registered tools and event handlers. */
class StubApi {
  readonly tools = new Map<string, RecordedTool>();
  readonly handlers = new Map<string, EventHandler>();
  active: string[] = ["edit", "substitute_edit", "read", "ls"];

  registerTool(def: RecordedTool): void {
    this.tools.set(def.name, def);
  }

  on(event: string, handler: EventHandler): void {
    this.handlers.set(event, handler);
  }

  getActiveTools(): string[] {
    return this.active;
  }

  setActiveTools(tools: string[]): void {
    this.active = tools;
  }
}

/**
 * Create an isolated cwd with a `.pi/settings.json` so the snap-edit gate
 * (`readExtensionGate`) resolves deterministically regardless of the host
 * checkout's own settings. Restores the original cwd on cleanup.
 */
async function withIsolatedCwd(
  snapEdit: boolean,
  fn: (cwd: string) => Promise<void>,
): Promise<void> {
  const originalCwd = process.cwd();
  const tmp = await mkdtemp(path.join(os.tmpdir(), "snap-edit-test-"));
  await mkdir(path.join(tmp, ".pi"), { recursive: true });
  await writeFile(
    path.join(tmp, ".pi", "settings.json"),
    JSON.stringify({
      "pi-harness": { profile: "full", extensions: { snapEdit } },
    }),
    "utf8",
  );
  process.chdir(tmp);
  try {
    await fn(tmp);
  } finally {
    process.chdir(originalCwd);
  }
}

test("snap-edit registers nothing when the gate is off", async () => {
  await withIsolatedCwd(false, async () => {
    const api = new StubApi();
    snapEditExtension(api as unknown as ExtensionAPI);
    assert.equal(api.tools.size, 0, "no tools should register when the gate is off");
    assert.equal(api.handlers.size, 0, "no event handlers should register when the gate is off");
  });
});

test("snap-edit registers quick_edit and target_edit when the gate is on", async () => {
  await withIsolatedCwd(true, async () => {
    const api = new StubApi();
    snapEditExtension(api as unknown as ExtensionAPI);
    assert.ok(api.tools.has("quick_edit"), "quick_edit should be registered");
    assert.ok(api.tools.has("target_edit"), "target_edit should be registered");
    assert.ok(api.handlers.has("session_start"), "a session_start handler should be registered");
    assert.ok(api.handlers.has("tool_result"), "a tool_result handler should be registered");
  });
});

test("read tool results receive absolute line numbers", async () => {
  await withIsolatedCwd(true, async (cwd) => {
    const api = new StubApi();
    snapEditExtension(api as unknown as ExtensionAPI);
    const handler = api.handlers.get("tool_result");
    assert.ok(handler, "tool_result handler must exist");

    await writeFile(path.join(cwd, "read.txt"), "alpha\nbeta\ngamma\n", "utf8");
    const result = (await handler(
      {
        toolName: "read",
        isError: false,
        input: { path: "read.txt", offset: 2 },
        content: [{ type: "text", text: "beta\ngamma" }],
      },
      {},
    )) as { content: Array<{ type: string; text: string }> };

    assert.equal(result.content[0]?.text, "2| beta\n3| gamma");
  });
});

test("session_start swaps edit/substitute_edit for quick_edit/target_edit", async () => {
  await withIsolatedCwd(true, async () => {
    const api = new StubApi();
    snapEditExtension(api as unknown as ExtensionAPI);

    const handler = api.handlers.get("session_start");
    assert.ok(handler, "session_start handler must exist");
    await handler({}, {});

    assert.ok(!api.active.includes("edit"), "edit should be removed from active tools");
    assert.ok(!api.active.includes("substitute_edit"), "substitute_edit should be removed from active tools");
    assert.ok(api.active.includes("quick_edit"), "quick_edit should be active");
    assert.ok(api.active.includes("target_edit"), "target_edit should be active");
    assert.ok(api.active.includes("read"), "unrelated tools should be preserved");
  });
});

test("a valid eof quick_edit appends lines and returns a diff", async () => {
  await withIsolatedCwd(true, async (cwd) => {
    const api = new StubApi();
    snapEditExtension(api as unknown as ExtensionAPI);
    const quickEdit = api.tools.get("quick_edit");
    assert.ok(quickEdit, "quick_edit tool must be registered");

    const file = path.join(cwd, "sample.txt");
    await writeFile(file, "alpha\nbeta\n", "utf8");

    const result = (await quickEdit.execute(
      "call-1",
      { path: file, edits: [{ start: "eof", lines: ["gamma"] }] },
      undefined,
      undefined,
      { cwd },
    )) as { content?: Array<{ type: string; text: string }> };

    const after = await readFile(file, "utf8");
    assert.equal(after, "alpha\nbeta\ngamma\n", "eof edit should append the new line");
    assert.ok(
      Array.isArray(result.content) && result.content.length > 0 && result.content[0].text.length > 0,
      "a non-empty diff/context payload should be returned",
    );
  });
});

test("a valid target_edit replaces the selected occurrence", async () => {
  await withIsolatedCwd(true, async (cwd) => {
    const api = new StubApi();
    snapEditExtension(api as unknown as ExtensionAPI);
    const targetEdit = api.tools.get("target_edit");
    assert.ok(targetEdit, "target_edit tool must be registered");

    const file = path.join(cwd, "target.txt");
    await writeFile(file, "alpha\nbeta\n", "utf8");

    await targetEdit.execute(
      "call-target",
      {
        path: file,
        ops: [{ type: "replace", target: "beta", line: 2, replacement: "gamma" }],
      },
      undefined,
      undefined,
      { cwd },
    );

    assert.equal(await readFile(file, "utf8"), "alpha\ngamma\n");
  });
});

test("an invalid quick_edit throws and leaves the file untouched (atomic)", async () => {
  await withIsolatedCwd(true, async (cwd) => {
    const api = new StubApi();
    snapEditExtension(api as unknown as ExtensionAPI);
    const quickEdit = api.tools.get("quick_edit");
    assert.ok(quickEdit, "quick_edit tool must be registered");

    const file = path.join(cwd, "guarded.txt");
    const original = "alpha\nbeta\n";
    await writeFile(file, original, "utf8");

    // Wrong expectedStartLine guard: the edit must fail before any write.
    await assert.rejects(
      () =>
        quickEdit.execute(
          "call-2",
          {
            path: file,
            edits: [
              {
                start: 1,
                end: 1,
                expectedStartLine: "WRONG-DOES-NOT-MATCH",
                lines: ["replaced"],
              },
            ],
          },
          undefined,
          undefined,
          { cwd },
        ),
      (err: unknown) => {
        const e = err as { name?: string; error_code?: string };
        return (
          (e.name === "SnapEditError" || e.error_code === "EXPECTED_START_LINE_MISMATCH") === true
        );
      },
      "a guard failure should throw a SnapEditError",
    );

    const after = await readFile(file, "utf8");
    assert.equal(after, original, "file must be unchanged when a guarded edit fails");
  });
});