/**
 * Tests for the checkpoint extension's pure logic:
 * config defaults, session-id extraction, checkpoint file naming,
 * FIFO pruning decisions, markdown serialization, rebuild-context
 * framing, artifact block parsing, and the on-disk rebuild path.
 *
 * TUI/session interaction is intentionally not covered here — the
 * pure pieces are exported precisely so they can be tested without it.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import { DEFAULT_CHECKPOINT_CONFIG } from "./config.ts";
import {
  findPiDir,
  formatRebuildContext,
  getCheckpointRebuildContext,
  getSessionId,
  parseCheckpointFilename,
  renderCheckpointMarkdown,
  selectCheckpointsToPrune,
} from "./index.ts";
import {
  parseActiveBlocks,
  summarizeActiveTasks,
  type CheckpointContent,
  type ParsedBlock,
} from "./subagent.ts";

function emptyContent(overrides: Partial<CheckpointContent> = {}): CheckpointContent {
  return {
    discoveries: "",
    filesRead: [],
    filesModified: [],
    activeTasks: "",
    ...overrides,
  };
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "checkpoint-test-"));
}

// ── config ──────────────────────────────────────────────────────────────────

test("default config is enabled with sane limits", () => {
  assert.equal(DEFAULT_CHECKPOINT_CONFIG.enabled, true);
  assert.equal(DEFAULT_CHECKPOINT_CONFIG.dir, "checkpoints");
  assert.ok(DEFAULT_CHECKPOINT_CONFIG.maxPerSession > 0);
  assert.ok(DEFAULT_CHECKPOINT_CONFIG.rebuildBudget > 0);
  assert.ok(DEFAULT_CHECKPOINT_CONFIG.maxFileSize > 0);
  assert.equal(DEFAULT_CHECKPOINT_CONFIG.autoOnCompress, true);
  assert.equal(DEFAULT_CHECKPOINT_CONFIG.autoOnOverflow, true);
});

// ── getSessionId ────────────────────────────────────────────────────────────

test("getSessionId probes known field spellings in order", () => {
  assert.equal(getSessionId({ sessionId: "a", session_id: "b", id: "c" }), "a");
  assert.equal(getSessionId({ session_id: "b", id: "c" }), "b");
  assert.equal(getSessionId({ id: "c" }), "c");
});

test("getSessionId returns null for missing, empty, or non-string ids", () => {
  assert.equal(getSessionId({}), null);
  assert.equal(getSessionId({ sessionId: "" }), null);
  assert.equal(getSessionId({ sessionId: 42 }), null);
  assert.equal(getSessionId(null), null);
  assert.equal(getSessionId(undefined), null);
  assert.equal(getSessionId("not-an-object"), null);
});

test("getSessionId falls through an empty spelling to the next one", () => {
  assert.equal(getSessionId({ sessionId: "", session_id: "b" }), "b");
});

// ── parseCheckpointFilename ─────────────────────────────────────────────────

test("parseCheckpointFilename accepts only checkpoint-<n>.md", () => {
  assert.equal(parseCheckpointFilename("checkpoint-1.md"), 1);
  assert.equal(parseCheckpointFilename("checkpoint-42.md"), 42);
  assert.equal(parseCheckpointFilename("checkpoint-007.md"), 7);
  assert.equal(parseCheckpointFilename("checkpoint-.md"), null);
  assert.equal(parseCheckpointFilename("checkpoint-1.txt"), null);
  assert.equal(parseCheckpointFilename("checkpoint-1.md.bak"), null);
  assert.equal(parseCheckpointFilename("notes.md"), null);
  assert.equal(parseCheckpointFilename("checkpoint-x.md"), null);
});

// ── selectCheckpointsToPrune ────────────────────────────────────────────────

test("selectCheckpointsToPrune keeps the newest maxPerSession entries", () => {
  const sortedNewestFirst = ["cp5", "cp4", "cp3", "cp2", "cp1"];
  assert.deepEqual(selectCheckpointsToPrune(sortedNewestFirst, 3), ["cp2", "cp1"]);
});

test("selectCheckpointsToPrune prunes nothing at or under the limit", () => {
  assert.deepEqual(selectCheckpointsToPrune(["a", "b"], 2), []);
  assert.deepEqual(selectCheckpointsToPrune(["a"], 2), []);
  assert.deepEqual(selectCheckpointsToPrune([], 2), []);
});

// ── renderCheckpointMarkdown ────────────────────────────────────────────────

test("renderCheckpointMarkdown renders all sections with content", () => {
  const md = renderCheckpointMarkdown(
    3,
    "2026-07-27T00:00:00.000Z",
    "sess-1",
    emptyContent({
      discoveries: "Found the bug in the parser.",
      filesRead: ["a.ts"],
      filesModified: ["b.ts"],
      activeTasks: "## Fix parser\n- [ ] add test",
      memoryObservations: "Observed X.",
    }),
  );

  assert.ok(md.startsWith("# Checkpoint #3\nWritten: 2026-07-27T00:00:00.000Z"));
  assert.ok(md.includes("## Discoveries\nFound the bug in the parser."));
  assert.ok(md.includes("Modified: b.ts"));
  assert.ok(md.includes("Read: a.ts"));
  assert.ok(md.includes("## Active Tasks\n## Fix parser\n- [ ] add test"));
  assert.ok(md.includes("## Recent Observations\nObserved X."));
  assert.ok(md.includes("- Session: sess-1"));
  assert.ok(md.includes("- Checkpoint #: 3"));
});

test("renderCheckpointMarkdown falls back to placeholders when empty", () => {
  const md = renderCheckpointMarkdown(1, "2026-07-27T00:00:00.000Z", "sess-1", emptyContent());

  assert.ok(md.includes("(no discoveries recorded yet)"));
  assert.ok(md.includes("No files tracked yet."));
  assert.ok(md.includes("(no active tasks)"));
  assert.ok(!md.includes("## Recent Observations"));
});

test("renderCheckpointMarkdown lists at most 10 files per category", () => {
  const files = Array.from({ length: 15 }, (_, i) => `file-${i}.ts`);
  const md = renderCheckpointMarkdown(
    1,
    "2026-07-27T00:00:00.000Z",
    "sess-1",
    emptyContent({ filesModified: files }),
  );

  assert.ok(md.includes("file-9.ts"));
  assert.ok(!md.includes("file-10.ts"));
});

// ── formatRebuildContext ────────────────────────────────────────────────────

test("formatRebuildContext frames the checkpoint and truncates to budget", () => {
  const framed = formatRebuildContext("0123456789ABCDEF", 10);
  assert.ok(framed.includes("## Prior Session Context (Checkpoint)"));
  assert.ok(framed.includes("0123456789"));
  assert.ok(!framed.includes("ABCDEF"));
  assert.ok(framed.trimEnd().endsWith("Continue from where you left off."));
});

// ── parseActiveBlocks ───────────────────────────────────────────────────────

test("parseActiveBlocks splits on ### headings and reads status + checkboxes", () => {
  const blocks = parseActiveBlocks(
    [
      "# Top-level ignored",
      "### Task One",
      "status: active",
      "- [ ] first step",
      "- [x] second step",
      "* [X] third step",
      "### Task Two",
      "status: done",
      "Some context line",
    ].join("\n"),
  );

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].title, "Task One");
  assert.equal(blocks[0].status, "active");
  assert.deepEqual(blocks[0].checkboxes, [
    { text: "first step", done: false },
    { text: "second step", done: true },
    { text: "third step", done: true },
  ]);
  assert.equal(blocks[1].title, "Task Two");
  assert.equal(blocks[1].status, "done");
  assert.deepEqual(blocks[1].firstContentLines, ["Some context line"]);
});

test("parseActiveBlocks ignores unknown status values and pre-heading lines", () => {
  const blocks = parseActiveBlocks(
    ["- [ ] orphan checkbox before any heading", "### Task", "status: bogus", "- [ ] step"].join(
      "\n",
    ),
  );

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].status, null);
  assert.equal(blocks[0].checkboxes.length, 1);
});

test("parseActiveBlocks captures at most 5 content lines, none after checkboxes", () => {
  const lines = ["### Task"];
  for (let i = 1; i <= 7; i++) lines.push(`content line ${i}`);
  lines.push("- [ ] a checkbox");
  lines.push("content after checkbox");
  const [block] = parseActiveBlocks(lines.join("\n"));

  assert.equal(block.firstContentLines.length, 5);
  assert.equal(block.firstContentLines[4], "content line 5");
  assert.ok(!block.firstContentLines.includes("content after checkbox"));
});

test("parseActiveBlocks returns no blocks for empty input", () => {
  assert.deepEqual(parseActiveBlocks(""), []);
});

// ── summarizeActiveTasks ────────────────────────────────────────────────────

function block(overrides: Partial<ParsedBlock>): ParsedBlock {
  return { title: "t", status: null, checkboxes: [], firstContentLines: [], ...overrides };
}

test("summarizeActiveTasks renders open TODO blocks and skips completed ones", () => {
  const summary = summarizeActiveTasks(
    [
      block({
        title: "Open work",
        status: "active",
        checkboxes: [
          { text: "todo item", done: false },
          { text: "done item", done: true },
        ],
      }),
      block({
        title: "Finished work",
        status: "done",
        checkboxes: [{ text: "all done", done: true }],
      }),
    ],
    [],
  );

  assert.ok(summary.includes("## Open work"));
  assert.ok(summary.includes("- [ ] todo item"));
  assert.ok(summary.includes("- [x] done item"));
  assert.ok(!summary.includes("Finished work"));
});

test("summarizeActiveTasks keeps a done-status block that still has open boxes", () => {
  const summary = summarizeActiveTasks(
    [
      block({
        title: "Mislabeled",
        status: "done",
        checkboxes: [{ text: "still open", done: false }],
      }),
    ],
    [],
  );
  assert.ok(summary.includes("## Mislabeled"));
});

test("summarizeActiveTasks limits blocks to 3 and checkboxes to 10", () => {
  const todoBlocks = Array.from({ length: 5 }, (_, i) =>
    block({
      title: `Block ${i}`,
      checkboxes: Array.from({ length: 12 }, (_, j) => ({ text: `item ${j}`, done: false })),
    }),
  );
  const summary = summarizeActiveTasks(todoBlocks, []);

  assert.ok(summary.includes("## Block 2"));
  assert.ok(!summary.includes("## Block 3"));
  assert.ok(summary.includes("- [ ] item 9"));
  assert.ok(!summary.includes("- [ ] item 10"));
});

test("summarizeActiveTasks includes only active progress blocks with content", () => {
  const summary = summarizeActiveTasks(
    [],
    [
      block({ title: "Running", status: "active", firstContentLines: ["step 1", "step 2"] }),
      block({ title: "Stale", status: "abandoned", firstContentLines: ["ignored"] }),
      block({ title: "Empty", status: "active", firstContentLines: [] }),
    ],
  );

  assert.ok(summary.includes("Progress (Running):"));
  assert.ok(summary.includes("step 1"));
  assert.ok(!summary.includes("Stale"));
  assert.ok(!summary.includes("Empty"));
});

test("summarizeActiveTasks falls back to placeholder with no blocks", () => {
  assert.equal(summarizeActiveTasks([], []), "(no active tasks)");
});

// ── findPiDir ───────────────────────────────────────────────────────────────

test("findPiDir finds .pi in the starting directory and in ancestors", async () => {
  const tmp = await makeTempDir();
  try {
    const piDir = path.join(tmp, ".pi");
    const nested = path.join(tmp, "a", "b", "c");
    await mkdir(piDir, { recursive: true });
    await mkdir(nested, { recursive: true });

    assert.equal(findPiDir(tmp), piDir);
    assert.equal(findPiDir(nested), piDir);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("findPiDir gives up after 10 levels", async () => {
  const tmp = await makeTempDir();
  try {
    // .pi exists only at the tmp root, 11 levels above the starting directory.
    await mkdir(path.join(tmp, ".pi"), { recursive: true });
    const segments = Array.from({ length: 11 }, (_, i) => `d${i}`);
    const deep = path.join(tmp, ...segments);
    await mkdir(deep, { recursive: true });

    assert.equal(findPiDir(deep), null);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ── getCheckpointRebuildContext (on-disk rebuild path) ──────────────────────

test("getCheckpointRebuildContext returns the highest-numbered checkpoint", async () => {
  const tmp = await makeTempDir();
  try {
    const sessionDir = path.join(tmp, ".pi", "checkpoints", "sess-1");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, "checkpoint-1.md"), "old checkpoint", "utf-8");
    await writeFile(path.join(sessionDir, "checkpoint-2.md"), "new checkpoint", "utf-8");

    const context = await getCheckpointRebuildContext(tmp, "sess-1");
    assert.ok(context);
    assert.ok(context.includes("new checkpoint"));
    assert.ok(!context.includes("old checkpoint"));
    assert.ok(context.includes("## Prior Session Context (Checkpoint)"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("getCheckpointRebuildContext falls back to other sessions' checkpoints", async () => {
  const tmp = await makeTempDir();
  try {
    const otherSession = path.join(tmp, ".pi", "checkpoints", "sess-other");
    await mkdir(otherSession, { recursive: true });
    await writeFile(path.join(otherSession, "checkpoint-1.md"), "borrowed context", "utf-8");

    const context = await getCheckpointRebuildContext(tmp, "sess-without-checkpoints");
    assert.ok(context);
    assert.ok(context.includes("borrowed context"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("getCheckpointRebuildContext returns null with no checkpoints or when disabled", async () => {
  const tmp = await makeTempDir();
  try {
    await mkdir(path.join(tmp, ".pi"), { recursive: true });
    assert.equal(await getCheckpointRebuildContext(tmp, "sess-1"), null);

    const sessionDir = path.join(tmp, ".pi", "checkpoints", "sess-1");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, "checkpoint-1.md"), "content", "utf-8");
    assert.equal(
      await getCheckpointRebuildContext(tmp, "sess-1", {
        ...DEFAULT_CHECKPOINT_CONFIG,
        enabled: false,
      }),
      null,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("getCheckpointRebuildContext truncates content to the rebuild budget", async () => {
  const tmp = await makeTempDir();
  try {
    const sessionDir = path.join(tmp, ".pi", "checkpoints", "sess-1");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, "checkpoint-1.md"), "KEEP-ME" + "x".repeat(100), "utf-8");

    const context = await getCheckpointRebuildContext(tmp, "sess-1", {
      ...DEFAULT_CHECKPOINT_CONFIG,
      rebuildBudget: 7,
    });
    assert.ok(context);
    assert.ok(context.includes("KEEP-ME"));
    assert.ok(!context.includes("KEEP-MEx"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
