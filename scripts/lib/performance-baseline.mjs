import { Buffer } from "node:buffer";

function round(value) {
  return Number(value.toFixed(3));
}

export function summarizeDurations(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("at least one duration sample is required");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return {
    unit: "ms",
    samples: sorted.length,
    min: round(sorted[0]),
    median: round(median),
    max: round(sorted.at(-1)),
  };
}

export function contextFootprint(parts) {
  const combined = parts.join("");
  const characters = [...combined].length;
  return {
    unit: "bytes",
    bytes: Buffer.byteLength(combined, "utf8"),
    characters,
    estimatedTokens: Math.ceil(characters / 4),
    tokenEstimateMethod: "ceil(characters/4); not tokenizer output",
  };
}

export function buildPerformanceBaseline({
  startupDurationsMs,
  contextParts,
  pollingDurationsMs,
  pollingIterations,
  resourceCounts,
  environment,
}) {
  return {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    environment,
    measurements: {
      startup: {
        operation: "DefaultResourceLoader construction and reload for the Full-profile checkout",
        ...summarizeDurations(startupDurationsMs),
        resourceCounts,
      },
      context: {
        operation: "portable policy files plus discovered skill descriptions",
        ...contextFootprint(contextParts),
      },
      polling: {
        operation: "sequential fs.stat of the Todo state file as a periodic-update I/O proxy",
        ...summarizeDurations(pollingDurationsMs),
        iterations: pollingIterations,
      },
    },
    limitations: [
      "Startup measures local resource discovery, not terminal rendering or provider latency.",
      "Context tokens are a labelled character-based estimate, not model tokenizer output or the complete host system prompt.",
      "Polling is a local file-I/O proxy; it does not measure provider requests or live TUI repaint cost.",
      "Timing results are descriptive baselines, not pass/fail performance budgets.",
    ],
  };
}
