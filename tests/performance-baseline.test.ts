import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPerformanceBaseline,
  contextFootprint,
  summarizeDurations,
} from "../scripts/lib/performance-baseline.mjs";

test("duration summaries expose units and stable distribution fields", () => {
  assert.deepEqual(summarizeDurations([3, 1, 2]), {
    unit: "ms",
    samples: 3,
    min: 1,
    median: 2,
    max: 3,
  });
});

test("context footprint counts exact UTF-8 bytes and labels token estimates", () => {
  assert.deepEqual(contextFootprint(["abcd", "é"]), {
    unit: "bytes",
    bytes: 6,
    characters: 5,
    estimatedTokens: 2,
    tokenEstimateMethod: "ceil(characters/4); not tokenizer output",
  });
});

test("performance baseline schema reports startup, context, polling, and limitations", () => {
  const report = buildPerformanceBaseline({
    startupDurationsMs: [4, 2, 3],
    contextParts: ["policy", "skills"],
    pollingDurationsMs: [0.2, 0.1],
    pollingIterations: 2,
    resourceCounts: { extensions: 3, skills: 4, prompts: 5, themes: 1 },
    environment: { node: "v-test", platform: "test", arch: "test" },
  });

  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(Object.keys(report.measurements), ["startup", "context", "polling"]);
  assert.equal(report.measurements.polling.iterations, 2);
  assert.match(report.limitations.join(" "), /not.*provider|proxy/i);
  assert.doesNotThrow(() => JSON.stringify(report));
});
