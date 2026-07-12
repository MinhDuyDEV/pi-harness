/**
 * DCP Extension — Recall Types & Constants
 */

import { join } from "node:path";
import { homedir } from "node:os";

export interface RecallEntry {
  index: number;
  source: "dcp" | "jsonl";
  sessionKey?: string;
  role?: string;
  title: string;
  text: string;
  timestamp?: number;
  path?: string;
}

export interface RecallOptions {
  sessionId: string;
  sessionFile?: string;
  query?: string;
  expand?: number[];
  page?: number;
  scope?: "active" | "all";
  limit?: number;
}

export interface RecallResult {
  entries: RecallEntry[];
  rendered: string;
  total: number;
}

export const RAW_SESSION_DIR = join(homedir(), ".pi", "agent", "sessions");
