import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatWorkingMessageWithPaddingTop,
  pickRandomWorkingQuote,
  readWorkingPaddingTop,
  WORKING_QUOTES,
  workingStatusSpacerLines,
} from "../working-indicator.js";

describe("working-indicator", () => {
  it("readWorkingPaddingTop defaults and clamps", () => {
    assert.equal(readWorkingPaddingTop(undefined), 1);
    assert.equal(readWorkingPaddingTop(2.7), 2);
    assert.equal(readWorkingPaddingTop(-1), 0);
    assert.equal(readWorkingPaddingTop(99), 8);
  });

  it("workingStatusSpacerLines", () => {
    assert.deepEqual(workingStatusSpacerLines(0), []);
    assert.equal(workingStatusSpacerLines(2).length, 2);
  });

  it("formatWorkingMessageWithPaddingTop with explicit baseMessage", () => {
    assert.equal(formatWorkingMessageWithPaddingTop(0, "Working..."), undefined);
    assert.equal(formatWorkingMessageWithPaddingTop(2, "Working..."), "\n\nWorking...");
  });

  it("formatWorkingMessageWithPaddingTop default picks from the quote pool", () => {
    const out = formatWorkingMessageWithPaddingTop(2);
    assert.ok(out !== undefined);
    const body = out!.replace(/^\n+/, "");
    assert.ok(
      WORKING_QUOTES.includes(body),
      `expected body to be a known quote, got: ${body}`,
    );
  });

  it("pickRandomWorkingQuote stays within the pool", () => {
    for (let i = 0; i < 32; i++) {
      assert.ok(WORKING_QUOTES.includes(pickRandomWorkingQuote()));
    }
    assert.ok(WORKING_QUOTES.length >= 8, "pool should have enough variety");
  });
});