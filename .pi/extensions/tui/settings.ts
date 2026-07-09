import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

import { readWorkingPaddingTop } from "./working-indicator.js";

const GLOBAL_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

export interface PiTuiSettings {
  /** Blank lines above the streaming "⠙ Working..." row (fixed-editor status slice + loader message). Default 1. */
  workingPaddingTop?: number;
  /**
   * Mirrors the top-level `editorPaddingX` UI setting (0-3, default 0).
   * Controls horizontal padding for the input editor. We clamp invalid values
   * to the documented 0-3 range and default to 0 when missing.
   */
  editorPaddingX?: number;
  /**
   * Mirrors the top-level `terminal.showTerminalProgress` setting from
   * `.pi/settings.json`. When false (the default), the extension must not
   * emit OSC 9;4 progress sequences directly to stdout — the user has
   * explicitly opted out. Only `true` means "user wants the tab-bar progress".
   */
  showTerminalProgress?: boolean;
  fixedEditorEnabled?: boolean;
  keyboardScrollShortcuts?: {
    up: string;
    down: string;
    top?: string;
    bottom?: string;
  };
}

/** @deprecated Use PiTuiSettings */
export type AmpTuiSettings = PiTuiSettings;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPiTuiBlock(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  const piTui = parsed?.piTui;
  if (piTui && typeof piTui === "object") return piTui as Record<string, unknown>;
  const legacy = parsed?.ampTui;
  if (legacy && typeof legacy === "object") return legacy as Record<string, unknown>;
  return undefined;
}

function findSettingsPath(cwd: string): string | null {
  let current = resolve(cwd);
  for (let depth = 0; depth < 8; depth++) {
    const nested = join(current, ".pi", "settings.json");
    if (existsSync(nested)) return nested;

    const direct = join(current, "settings.json");
    if (basename(current) === ".pi" && existsSync(direct)) return direct;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Read `terminal.showTerminalProgress` from the top-level `terminal` block.
 * Defaults to `false` (matches pi core's `getShowTerminalProgress()`), so an
 * absent key or a non-boolean value means "do not show".
 */
function readShowTerminalProgress(parsed: Record<string, unknown>): boolean {
  const term = parsed?.terminal;
  if (!term || typeof term !== "object") return false;
  return (term as Record<string, unknown>).showTerminalProgress === true;
}

/**
 * Read `editorPaddingX` from the top level of the merged settings file.
 * Per pi docs: number 0-3, default 0. Anything else is clamped to the range.
 */
function readEditorPaddingX(parsed: Record<string, unknown>): number {
  const raw = parsed?.editorPaddingX;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(3, Math.trunc(raw)));
}

/** Read and merge settings from global (~/.pi/agent/settings.json) then project (.pi/settings.json). */
export function readPiTuiSettings(cwd: string): PiTuiSettings {
  // 1. Start with the global settings file as the base.
  let merged: Record<string, unknown> = {};
  if (existsSync(GLOBAL_SETTINGS_PATH)) {
    try {
      merged = JSON.parse(readFileSync(GLOBAL_SETTINGS_PATH, "utf-8")) as Record<string, unknown>;
    } catch {
      // ignore — fall through to project
    }
  }

  // 2. Find and parse the project file.
  const projectPath = findSettingsPath(cwd);
  let projectParsed: Record<string, unknown> | undefined;
  if (projectPath) {
    try {
      projectParsed = JSON.parse(readFileSync(projectPath, "utf-8")) as Record<string, unknown>;
      // Overlay project onto global (project wins on conflicts).
      merged = { ...merged, ...projectParsed };
      // Deep-merge the terminal block.
      const projectTerm = projectParsed.terminal;
      if (projectTerm && typeof projectTerm === "object") {
        merged.terminal = {
          ...((merged.terminal ?? {}) as Record<string, unknown>),
          ...(projectTerm as Record<string, unknown>),
        };
      }
    } catch {
      // ignore
    }
  }

  // 3. Top-level settings come from the merged result (global + project overlay).
  const showTerminalProgress = readShowTerminalProgress(merged);
  const editorPaddingX = readEditorPaddingX(merged);

  // 4. PiTui-specific settings come from the *project* file only.
  if (!projectParsed) return { showTerminalProgress, editorPaddingX };

  const block = readPiTuiBlock(projectParsed);
  const workingPaddingTop = readWorkingPaddingTop(block?.workingPaddingTop);

  // Resolve fixed-editor enable from several historical *project* shapes.
  // Live project settings used `powerline.fixedEditor: true` which was
  // silently ignored (reader only accepted piTui.fixedEditor.enabled === true),
  // so compositor + height-stabilize never installed → slash black flash.
  // Project-only: do not inherit global fixedEditor (avoids surprise enable).
  const resolved = resolveFixedEditorConfig(projectParsed, block);
  const fixedEditorEnabled = resolved.enabled;
  const fixedEditor = resolved.block;
  const up = nonEmptyString(fixedEditor?.scrollChatUp);
  const down = nonEmptyString(fixedEditor?.scrollChatDown);
  const shortcuts =
    up && down
      ? {
          keyboardScrollShortcuts: {
            up,
            down,
            ...(nonEmptyString(fixedEditor?.scrollChatTop)
              ? { top: nonEmptyString(fixedEditor?.scrollChatTop)! }
              : {}),
            ...(nonEmptyString(fixedEditor?.scrollChatBottom)
              ? { bottom: nonEmptyString(fixedEditor?.scrollChatBottom)! }
              : {}),
          },
        }
      : {};
  return { workingPaddingTop, showTerminalProgress, editorPaddingX, fixedEditorEnabled, ...shortcuts };
}

/**
 * Accept (project settings only):
 * - piTui.fixedEditor: true
 * - piTui.fixedEditor: { enabled: true, scrollChatUp, ... }
 * - powerline.fixedEditor: true  (legacy misplaced key still in project settings)
 * - top-level fixedEditor: true | { enabled }
 */
function resolveFixedEditorConfig(
  projectParsed: Record<string, unknown>,
  piTuiBlock: Record<string, unknown> | undefined,
): { enabled: boolean; block: Record<string, unknown> | null } {
  const candidates: unknown[] = [
    piTuiBlock?.fixedEditor,
    projectParsed.fixedEditor,
    (projectParsed.powerline as Record<string, unknown> | undefined)?.fixedEditor,
  ];

  for (const candidate of candidates) {
    if (candidate === true) return { enabled: true, block: null };
    if (candidate === false) return { enabled: false, block: null };
    if (candidate && typeof candidate === "object") {
      const obj = candidate as Record<string, unknown>;
      if ("enabled" in obj) {
        return { enabled: obj.enabled === true, block: obj };
      }
      // Object with shortcuts but no `enabled` → treat as enabled (legacy).
      if (
        "scrollChatUp" in obj ||
        "scrollChatDown" in obj ||
        "scrollChatTop" in obj ||
        "scrollChatBottom" in obj
      ) {
        return { enabled: true, block: obj };
      }
    }
  }
  return { enabled: false, block: null };
}

/** @deprecated Use readPiTuiSettings */
export const readAmpTuiSettings = readPiTuiSettings;
