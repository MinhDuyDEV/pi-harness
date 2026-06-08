/**
 * Keyboard scroll detection and SGR mouse parsing.
 * Extracted from compositor.ts to reduce monolith size.
 */

import { isKeyRelease, matchesKey } from "@earendil-works/pi-tui";

// ── Keyboard scroll detection ───────────────────────────────────────────────

export interface KeyboardScrollShortcuts {
  up: string;
  down: string;
  top?: string;
  bottom?: string;
}

export type ScrollAction =
  | { kind: "scroll"; delta: number }
  | { kind: "top" }
  | { kind: "bottom" };

export const DEFAULT_KEYBOARD_SCROLL_SHORTCUTS: Required<KeyboardScrollShortcuts> = {
  up: "super+up",
  down: "super+down",
  top: "super+home",
  bottom: "super+end",
};

const SUPER_SHORTCUT_PATTERNS = new Map<string, RegExp>([
  ["super+up", /^\x1b\[(?:1;9(?::[12])?[AH]|574(?:19|23);9(?::[12])?u|7;9(?::[12])?~|27;9;65~)$/],
  ["super+down", /^\x1b\[(?:1;9(?::[12])?[BF]|574(?:20|24);9(?::[12])?u|8;9(?::[12])?~|27;9;66~)$/],
  ["super+home", /^\x1b\[(?:1;9(?::[12])?H|57423;9(?::[12])?u|7;9(?::[12])?~)$/],
  ["super+end", /^\x1b\[(?:1;9(?::[12])?F|57424;9(?::[12])?u|8;9(?::[12])?~)$/],
  ["super+pageup", /^\x1b\[(?:5;9(?::[12])?~|57421;9(?::[12])?u)$/],
  ["super+pagedown", /^\x1b\[(?:6;9(?::[12])?~|57422;9(?::[12])?u)$/],
]);

function matchesConfiguredShortcut(data: string, shortcut: string): boolean {
  const normalized = shortcut.toLowerCase();
  if (normalized.includes("super+")) {
    return SUPER_SHORTCUT_PATTERNS.get(normalized)?.test(data) ?? false;
  }
  return matchesKey(data, shortcut as Parameters<typeof matchesKey>[1]);
}

export function parseScrollAction(
  data: string,
  shortcuts: KeyboardScrollShortcuts = DEFAULT_KEYBOARD_SCROLL_SHORTCUTS,
): ScrollAction | null {
  if (isKeyRelease(data)) return null;

  const top = shortcuts.top ?? DEFAULT_KEYBOARD_SCROLL_SHORTCUTS.top;
  const bottom = shortcuts.bottom ?? DEFAULT_KEYBOARD_SCROLL_SHORTCUTS.bottom;
  if (
    matchesConfiguredShortcut(data, top) ||
    matchesKey(data, "ctrl+shift+home") ||
    /^\x1b\[(?:1;6(?::[12])?H|57423;6(?::[12])?u|7;6(?::[12])?~)$/.test(data)
  ) return { kind: "top" };
  if (
    matchesConfiguredShortcut(data, bottom) ||
    matchesKey(data, "ctrl+shift+end") ||
    /^\x1b\[(?:1;6(?::[12])?F|57424;6(?::[12])?u|8;6(?::[12])?~)$/.test(data)
  ) return { kind: "bottom" };

  if (
    matchesConfiguredShortcut(data, shortcuts.up) ||
    matchesKey(data, "pageUp") ||
    matchesKey(data, "ctrl+shift+up") ||
    /^\x1b\[(?:5;9(?::[12])?~|1;6(?::[12])?A|57421;9(?::[12])?u|57419;6(?::[12])?u)$/.test(data)
  ) return { kind: "scroll", delta: 10 };
  if (
    matchesConfiguredShortcut(data, shortcuts.down) ||
    matchesKey(data, "pageDown") ||
    matchesKey(data, "ctrl+shift+down") ||
    /^\x1b\[(?:6;9(?::[12])?~|1;6(?::[12])?B|57422;9(?::[12])?u|57420;6(?::[12])?u)$/.test(data)
  ) return { kind: "scroll", delta: -10 };
  return null;
}

// ── SGR mouse parsing ───────────────────────────────────────────────────────

export interface SgrPacket {
  code: number;
  col: number;
  row: number;
  final: "M" | "m";
}

export function parseSgrMouse(input: string): SgrPacket[] | null {
  const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  const packets: SgrPacket[] = [];
  let last = 0;
  for (const m of input.matchAll(re)) {
    if (m.index !== last) return null;
    last = m.index + m[0].length;
    packets.push({
      code: Number(m[1]),
      col: Number(m[2]),
      row: Number(m[3]),
      final: m[4] as "M" | "m",
    });
  }
  return packets.length > 0 && last === input.length ? packets : null;
}

function mouseBase(code: number): number {
  return code & ~(4 | 8 | 16 | 32);
}

export function mouseScrollDelta(pkt: SgrPacket): number {
  if (pkt.final !== "M") return 0;
  const b = mouseBase(pkt.code);
  if (b === 64) return 3;
  if (b === 65) return -3;
  return 0;
}

export function isLeftPress(pkt: SgrPacket): boolean {
  return pkt.final === "M" && mouseBase(pkt.code) === 0 && (pkt.code & 32) === 0;
}
export function isLeftDrag(pkt: SgrPacket): boolean {
  return pkt.final === "M" && mouseBase(pkt.code) === 0 && (pkt.code & 32) !== 0;
}
export function isRightPress(pkt: SgrPacket): boolean {
  return pkt.final === "M" && mouseBase(pkt.code) === 2 && (pkt.code & 32) === 0;
}
export function isMouseRelease(pkt: SgrPacket): boolean {
  return pkt.final === "m";
}
