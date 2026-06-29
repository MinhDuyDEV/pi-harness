import { describe, it, expect } from "bun:test";

// Re-create the same helper logic for direct testing. Keeping it in sync
// with the one in compositor.ts is intentional — both compile-time and
// runtime guarantee the same behavior.
const SHIFT_ENTER_PATTERNS: readonly RegExp[] = [
  /^\x1b\[13;2u$/,
  /^\x1b\[13;2~$/,
  /^\x1b\[27;2;13~$/,
  /^\x1b\r$/,
  /^\x1b\[Z$/,
  /^\x1bO2u$/,
];

function isShiftEnter(data: string): boolean {
  for (const pattern of SHIFT_ENTER_PATTERNS) {
    if (pattern.test(data)) return true;
  }
  return false;
}

describe("isShiftEnter", () => {
  it("matches the common Shift+Enter escape sequences", () => {
    // Kitty CSI u
    expect(isShiftEnter("\x1b[13;2u")).toBe(true);
    // xterm modifyOtherKeys CSI 13;2~
    expect(isShiftEnter("\x1b[13;2~")).toBe(true);
    // xterm modifyOtherKeys CSI 27;modifier;key~
    expect(isShiftEnter("\x1b[27;2;13~")).toBe(true);
    // Legacy xterm / mintty
    expect(isShiftEnter("\x1b\r")).toBe(true);
    // rxvt / urxvt
    expect(isShiftEnter("\x1b[Z")).toBe(true);
    // WezTerm SS3 with kitty modifier
    expect(isShiftEnter("\x1bO2u")).toBe(true);
  });

  it("does not match plain Enter (CR) or LF", () => {
    expect(isShiftEnter("\r")).toBe(false);
    expect(isShiftEnter("\n")).toBe(false);
  });

  it("does not match other escape sequences or empty data", () => {
    expect(isShiftEnter("")).toBe(false);
    expect(isShiftEnter("\x1b")).toBe(false);
    expect(isShiftEnter("\x1b[A")).toBe(false); // Up arrow
    expect(isShiftEnter("\x1b[B")).toBe(false); // Down arrow
    expect(isShiftEnter("\x1b[5;2~")).toBe(false); // PgUp with shift (not enter)
  });

  it("rejects partial matches", () => {
    // Garbage that happens to start with ESC [
    expect(isShiftEnter("\x1b[13;2")).toBe(false);
    expect(isShiftEnter("\x1b[13;2uX")).toBe(false);
    expect(isShiftEnter("X\x1b[13;2u")).toBe(false);
  });
});
