import { existsSync, readdirSync, readFileSync, statSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const RAW_SESSION_DIR = join(homedir(), ".pi", "agent", "sessions");

export function safeStat(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

export function rawSessionKey(path: string): string {
  return path.split(/[\\/]/).pop()?.replace(/\.jsonl?$/, "") ?? path;
}

export function listRawSessionFiles(scope: "active" | "all", sessionFile?: string): string[] {
  if (scope === "active" && sessionFile && existsSync(sessionFile)) return [sessionFile];
  if (!existsSync(RAW_SESSION_DIR)) return [];

  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const stat = safeStat(path);
      if (!stat) continue;
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile() && /\.jsonl?$/.test(name)) files.push(path);
    }
  };

  visit(RAW_SESSION_DIR);
  files.sort((left, right) => Number(safeStat(right)?.mtimeMs ?? 0) - Number(safeStat(left)?.mtimeMs ?? 0));
  return files.slice(0, scope === "all" ? 200 : 20);
}

export function readJsonlLines(path: string): unknown[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return line;
        }
      });
  } catch {
    return [];
  }
}

export function shouldIncludeJsonlEntry(value: unknown): boolean {
  if (typeof value === "string") return true;
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  if (object.type === "custom") return false;
  if (typeof object.customType === "string" && object.customType) return false;
  return true;
}

function payload(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  if (object.type === "message" && object.message && typeof object.message === "object") return object.message;
  if (object.type === "custom" && object.customType === "dcp_state") return object.data;
  return value;
}

export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) return content.map(contentToText).filter(Boolean).join("\n");
  if (typeof content !== "object") return String(content);

  const object = content as Record<string, unknown>;
  if (object.type === "thinking" || typeof object.thinking === "string") return "";
  if (object.type === "toolCall") return `tool call: ${String(object.name ?? object.toolName ?? "unknown")}`;
  if (typeof object.text === "string") return object.text;
  if (typeof object.content === "string" || Array.isArray(object.content)) return contentToText(object.content);
  if (object.message) return contentToText(object.message);
  if (object.output) return contentToText(object.output);
  if (object.result) return contentToText(object.result);
  if (object.data) return contentToText(object.data);
  return "";
}

export function jsonlText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return String(value ?? "");
  const object = payload(value);
  if (!object || typeof object !== "object") return contentToText(object);

  const record = object as Record<string, unknown>;
  if (record.snapshot && typeof record.snapshot === "object") {
    const blocks = Array.isArray((record.snapshot as Record<string, unknown>).blocks)
      ? ((record.snapshot as Record<string, unknown>).blocks as unknown[]).length
      : 0;
    return `DCP state snapshot (${blocks} block${blocks === 1 ? "" : "s"})`;
  }
  return contentToText(record.content ?? record.message ?? record.text ?? record.output ?? record.result ?? object);
}

export function jsonlRole(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const object = payload(value);
  if (object && typeof object === "object" && typeof (object as Record<string, unknown>).role === "string") {
    return (object as Record<string, unknown>).role as string;
  }
  const original = value as Record<string, unknown>;
  return String(original.customType ?? original.type ?? "");
}

export function jsonlTimestamp(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>).timestamp ?? (value as Record<string, unknown>).createdAt ?? (value as Record<string, unknown>).created_at;
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}
