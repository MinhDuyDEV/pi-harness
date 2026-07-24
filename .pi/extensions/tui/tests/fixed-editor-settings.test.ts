import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readPiTuiSettings } from "../settings.js";

function withProjectSettings(
  body: Record<string, unknown>,
  run: (cwd: string) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), "pi-tui-settings-"));
  try {
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(join(dir, ".pi", "settings.json"), JSON.stringify(body));
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("readPiTuiSettings fixedEditor enablement", () => {
  test("piTui.fixedEditor.enabled true", () => {
    withProjectSettings(
      { piTui: { fixedEditor: { enabled: true } } },
      (cwd) => {
        expect(readPiTuiSettings(cwd).fixedEditorEnabled).toBe(true);
      },
    );
  });

  test("piTui.fixedEditor boolean true", () => {
    withProjectSettings({ piTui: { fixedEditor: true } }, (cwd) => {
      expect(readPiTuiSettings(cwd).fixedEditorEnabled).toBe(true);
    });
  });

  test("legacy powerline.fixedEditor true enables compositor", () => {
    withProjectSettings({ powerline: { fixedEditor: true } }, (cwd) => {
      expect(readPiTuiSettings(cwd).fixedEditorEnabled).toBe(true);
    });
  });

  test("disabled when absent", () => {
    withProjectSettings({ piTui: { workingPaddingTop: 1 } }, (cwd) => {
      expect(readPiTuiSettings(cwd).fixedEditorEnabled).toBe(false);
    });
  });

  test("piTui.fixedEditor.enabled false wins over powerline true", () => {
    withProjectSettings(
      {
        powerline: { fixedEditor: true },
        piTui: { fixedEditor: { enabled: false } },
      },
      (cwd) => {
        expect(readPiTuiSettings(cwd).fixedEditorEnabled).toBe(false);
      },
    );
  });
});

describe("readPiTuiSettings todosWidget", () => {
  test("defaults to true when absent", () => {
    withProjectSettings({ piTui: { workingPaddingTop: 1 } }, (cwd) => {
      expect(readPiTuiSettings(cwd).todosWidget).toBe(true);
    });
  });

  test("false when piTui.todosWidget is false", () => {
    withProjectSettings({ piTui: { todosWidget: false } }, (cwd) => {
      expect(readPiTuiSettings(cwd).todosWidget).toBe(false);
    });
  });

  test("true when piTui.todosWidget is true", () => {
    withProjectSettings({ piTui: { todosWidget: true } }, (cwd) => {
      expect(readPiTuiSettings(cwd).todosWidget).toBe(true);
    });
  });
});
