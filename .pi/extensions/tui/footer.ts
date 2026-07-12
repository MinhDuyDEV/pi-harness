import { type TUI } from "@earendil-works/pi-tui";
import type { GitInfo } from "./git-status.js";

export interface FooterState {
  modelLabel: string;
  thinkingLevel: string;
  isStreaming: boolean;
  tokenCount: number;
  contextWindow: number;
  tui: TUI | null;
  git: GitInfo | null;
  cwd: string;
  turnElapsed: number;
  turnTokens: number;
  turnInputTokens: number;
  turnOutputTokens: number;
  turnCacheReadTokens: number;
  turnCacheWriteTokens: number;
  totalCostUsd: number;
}

export function createDefaultFooterState(): FooterState {
  return {
    modelLabel: "",
    thinkingLevel: "",
    isStreaming: false,
    tokenCount: 0,
    contextWindow: 0,
    tui: null,
    git: null,
    cwd: "",
    turnElapsed: 0,
    turnTokens: 0,
    turnInputTokens: 0,
    turnOutputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheWriteTokens: 0,
    totalCostUsd: 0,
  };
}
