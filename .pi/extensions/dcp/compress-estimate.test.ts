import { describe, expect, test } from "bun:test";
import type { Message } from "@earendil-works/pi-ai";
import { enrichCompactionResult, estimateTokensAfterCompress, estimateTokens } from "./compress.js";

describe("estimateTokensAfterCompress", () => {
  test("returns undefined without context baseline", () => {
    expect(estimateTokensAfterCompress(null, 1000, 200)).toBeUndefined();
    expect(estimateTokensAfterCompress(0, 1000, 200)).toBeUndefined();
  });

  test("subtracts removed estimate and adds summary tokens", () => {
    expect(estimateTokensAfterCompress(100_000, 40_000, 5_000)).toBe(65_000);
  });
});

describe("enrichCompactionResult", () => {
  test("updates estimatedTokensAfter when summary grows", () => {
    const userMsg = { role: "user", content: "x".repeat(400) } as Message;
    const preparation = {
      tokensBefore: 10_000,
      messagesToSummarize: [userMsg] as readonly Message[],
    };
    const result = {
      summary: "short",
      tokensBefore: 10_000,
      estimatedTokensAfter: 8_000,
    };
    const enriched = enrichCompactionResult(
      { ...result, summary: result.summary + "\n\n" + "y".repeat(800) },
      preparation,
    );
    expect(enriched.estimatedTokensAfter).toBeDefined();
        // Verify the estimator derives removedEstimate via estimateTokens(userMsg).
        expect(enriched.estimatedTokensAfter!).toBe(
          estimateTokensAfterCompress(
            10_000,
            estimateTokens(userMsg),
            Math.ceil(enriched.summary.length / 4),
          ),
        );
  });
});