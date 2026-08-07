export interface RecallEntry {
  index: number;
  source: "dcp" | "jsonl" | "task";
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
  warnings?: string[];
}

export const PAGE_SIZE = 5;
