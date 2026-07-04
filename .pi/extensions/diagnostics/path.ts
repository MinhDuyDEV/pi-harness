import fs from "node:fs";
import path from "node:path";

export function pathWhich(bin: string): string | undefined {
  const pathDirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, bin);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}