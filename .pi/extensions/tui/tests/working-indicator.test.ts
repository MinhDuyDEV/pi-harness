import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatWorkingMessageWithPaddingTop,
  readWorkingPaddingTop,
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

  it("formatWorkingMessageWithPaddingTop", () => {
    assert.equal(formatWorkingMessageWithPaddingTop(0), undefined);
    assert.equal(formatWorkingMessageWithPaddingTop(2), "\n\nWorking...");
  });
});