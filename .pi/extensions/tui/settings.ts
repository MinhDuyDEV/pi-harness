import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

import { readWorkingPaddingTop } from "./working-indicator.js";

const GLOBAL_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

export interface PiTuiSettings {
  /** Blank lines above the streaming "⠙ Working..." row (fixed-editor status slice + loader message). Default 1. */
  workingPaddingTop?: number;
  /**
   * Mirrors the top-level `terminal.showTerminalProgress` setting from
   * `.pi/settings.json`. When false (the default), the extension must not
   * emit OSC 9;4 progress sequences directly to stdout — the user has
   * explicitly opted out. Only `true` means "user wants the tab-bar progress".
   */
  showTerminalProgress?: boolean;
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

  // 3. showTerminalProgress from the merged result (global + project overlay).
  const showTerminalProgress = readShowTerminalProgress(merged);

  // 4. PiTui-specific settings come from the *project* file only.
  if (!projectParsed) return { showTerminalProgress };

  const block = readPiTuiBlock(projectParsed);
  const workingPaddingTop = readWorkingPaddingTop(block?.workingPaddingTop);
  const fixedEditor = block?.fixedEditor as Record<string, unknown> | undefined;
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
  return { workingPaddingTop, showTerminalProgress, ...shortcuts };
}

/** @deprecated Use readPiTuiSettings */
export const readAmpTuiSettings = readPiTuiSettings;
