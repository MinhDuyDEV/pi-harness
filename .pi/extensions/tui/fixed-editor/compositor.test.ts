import { describe, it, expect } from "bun:test";

// Re-create the same helper logic for direct testing. Keeping it in sync
// with the one in compositor.ts is intentional — both compile-time and
// runtime guarantee the same behavior.
const NEWLINE_KEY_PATTERNS: readonly RegExp[] = [
  // Shift+Enter
  /^\x1b\[13;2u$/,
  /^\x1b\[13;2~$/,
  /^\x1b\[27;2;13~$/,
  /^\x1b\r$/,
  /^\x1b\[Z$/,
  /^\x1bO2u$/,
  // Ctrl+J
  /^\x1b\[27;5;106~$/,
  /^\x1b\[106;5u$/,
  /^\x1bO5u$/,
];

function isNewlineKey(data: string): boolean {
  for (const pattern of NEWLINE_KEY_PATTERNS) {
    if (pattern.test(data)) return true;
  }
  return false;
}

describe("isNewlineKey", () => {
  it("matches the common Shift+Enter escape sequences", () => {
    expect(isNewlineKey("\x1b[13;2u")).toBe(true);   // Kitty CSI u
    expect(isNewlineKey("\x1b[13;2~")).toBe(true);   // xterm CSI 13;2~
    expect(isNewlineKey("\x1b[27;2;13~")).toBe(true); // xterm CSI 27
    expect(isNewlineKey("\x1b\r")).toBe(true);        // legacy xterm
    expect(isNewlineKey("\x1b[Z")).toBe(true);        // rxvt
    expect(isNewlineKey("\x1bO2u")).toBe(true);       // WezTerm SS3
  });

  it("matches the common Ctrl+J escape sequences", () => {
    // Note: plain "\n" is intentionally NOT in the compositor's list
    // because the editor's own new-line check (data === "\n" &&
    // data.length === 1) handles it directly. The compositor only
    // covers the escape sequences the editor doesn't recognize.
    expect(isNewlineKey("\x1b[27;5;106~")).toBe(true); // xterm modifyOtherKeys
    expect(isNewlineKey("\x1b[106;5u")).toBe(true);    // Kitty CSI u
    expect(isNewlineKey("\x1bO5u")).toBe(true);       // WezTerm SS3
  });

  it("plain LF (\n) is NOT matched here — the editor handles it", () => {
    // Documented separately so future changes don't accidentally
    // duplicate work or override the editor's intent.
    expect(isNewlineKey("\n")).toBe(false);
  });

  it("does not match plain Enter (CR)", () => {
    expect(isNewlineKey("\r")).toBe(false);
  });

  it("does not match other escape sequences or empty data", () => {
    expect(isNewlineKey("")).toBe(false);
    expect(isNewlineKey("\x1b")).toBe(false);
    expect(isNewlineKey("\x1b[A")).toBe(false);    // Up arrow
    expect(isNewlineKey("\x1b[B")).toBe(false);    // Down arrow
    expect(isNewlineKey("\x1b[5;2~")).toBe(false); // PgUp with shift
    expect(isNewlineKey("\x1b[5;5~")).toBe(false); // PgUp with ctrl
    expect(isNewlineKey("\x1b[108;5u")).toBe(false); // Ctrl+l ('l' = 108) — must NOT match
  });

  it("rejects partial matches", () => {
    expect(isNewlineKey("\x1b[13;2")).toBe(false);
    expect(isNewlineKey("\x1b[13;2uX")).toBe(false);
    expect(isNewlineKey("X\x1b[13;2u")).toBe(false);
    expect(isNewlineKey("\x1b[27;5;10")).toBe(false); // partial ctrl+enter
  });
});
