import type { FindOperations } from "@earendil-works/pi-coding-agent";
import { readdir, readFile, stat } from "fs/promises";
import { join, relative, sep } from "path";
import { normalizeGrepArgs } from "./normalize";
import { safeWorkspacePath } from "./normalize";

export const DEFAULT_CURSOR_GLOB_LIMIT = 1000;
export const DEFAULT_CURSOR_GREP_LIMIT = 1000;
const MAX_CURSOR_REGEX_LENGTH = 500;
const MAX_CURSOR_GREP_CONTEXT_LINES = 20;
const SKIPPED_SEARCH_DIRS = new Set([".git", ".omp", "node_modules"]);

function toPosixPath(filePath: string): string {
  return filePath.split(sep).join("/");
}

function escapeRegExpChar(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExpChar(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function globMatches(pattern: string | undefined, relativePath: string): boolean {
  const normalizedPattern = toPosixPath(pattern || "**/*");
  const normalizedPath = toPosixPath(relativePath);
  const matchTarget = normalizedPattern.includes("/") ? normalizedPath : normalizedPath.split("/").pop() || normalizedPath;
  return globToRegExp(normalizedPattern).test(matchTarget);
}

function throwIfAborted(signal: any) {
  if (signal?.aborted) throw new Error("Operation aborted");
}

function isRegexQuantifierStart(char: string | undefined): boolean {
  return char === "*" || char === "+" || char === "?" || char === "{";
}

function hasUnsafeRegexStructure(pattern: string): boolean {
  let inCharacterClass = false;
  const groupStack: Array<{ hasQuantifier: boolean; hasAlternation: boolean }> = [];

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") {
      if (/\d/.test(pattern[index + 1] || "")) return true;
      index += 1;
      continue;
    }
    if (inCharacterClass) {
      if (char === "]") inCharacterClass = false;
      continue;
    }
    if (char === "[") {
      inCharacterClass = true;
      continue;
    }
    if (char === "(") {
      groupStack.push({ hasQuantifier: false, hasAlternation: false });
      continue;
    }
    if (char === "|") {
      const current = groupStack[groupStack.length - 1];
      if (current) current.hasAlternation = true;
      continue;
    }
    if (char === ")") {
      const group = groupStack.pop();
      if (group && (group.hasQuantifier || group.hasAlternation) && isRegexQuantifierStart(pattern[index + 1])) {
        return true;
      }
      continue;
    }
    if (isRegexQuantifierStart(char)) {
      const current = groupStack[groupStack.length - 1];
      if (current) current.hasQuantifier = true;
    }
  }

  return false;
}

function createSafeRegexMatcher(pattern: string, ignoreCase: boolean): RegExp {
  if (pattern.length > MAX_CURSOR_REGEX_LENGTH) {
    throw new Error(`Regex pattern exceeds maximum length of ${MAX_CURSOR_REGEX_LENGTH} characters`);
  }
  if (hasUnsafeRegexStructure(pattern)) {
    throw new Error("Unsafe regex pattern: nested quantifiers, quantified alternation, and backreferences are not supported");
  }
  try {
    return new RegExp(pattern, ignoreCase ? "i" : undefined);
  } catch (error) {
    throw new Error(`Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function localGlob(pattern: string, searchPath: string, options: { ignore: string[]; limit: number }): Promise<string[]> {
  const results: string[] = [];
  const limit = Math.max(1, options.limit || DEFAULT_CURSOR_GLOB_LIMIT);

  async function visit(directory: string): Promise<void> {
    if (results.length >= limit) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.isDirectory() && SKIPPED_SEARCH_DIRS.has(entry.name)) continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        const relativePath = toPosixPath(relative(searchPath, absolutePath));
        if (globMatches(pattern, relativePath)) results.push(absolutePath);
      }
    }
  }

  await visit(searchPath);
  return results;
}

export const localFindOperations: FindOperations = {
  exists: pathExists,
  glob: localGlob,
};

async function collectLocalFiles(searchPath: string, rootPath: string, globPattern: string | undefined, signal: any): Promise<string[]> {
  throwIfAborted(signal);
  const info = await stat(searchPath);
  if (info.isFile()) return [searchPath];
  if (!info.isDirectory()) return [];

  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    throwIfAborted(signal);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      throwIfAborted(signal);
      if (entry.isDirectory() && SKIPPED_SEARCH_DIRS.has(entry.name)) continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        const relativePath = toPosixPath(relative(rootPath, absolutePath));
        if (!globPattern || globMatches(globPattern, relativePath)) files.push(absolutePath);
      }
    }
  }

  await visit(searchPath);
  return files;
}

export async function runLocalGrep(cwd: string, params: ReturnType<typeof normalizeGrepArgs>, signal: any) {
  throwIfAborted(signal);
  const searchPath = safeWorkspacePath(cwd, params.path || ".");
  const searchInfo = await stat(searchPath).catch(() => undefined);
  if (!searchInfo) throw new Error(`Path not found: ${searchPath}`);

  const pattern = params.pattern || "";
  if (!pattern) throw new Error("Grep requires a pattern");

  const ignoreCase = !!params.ignoreCase;
  const literalPattern = ignoreCase ? pattern.toLowerCase() : pattern;
  const matcher = params.literal ? undefined : createSafeRegexMatcher(pattern, ignoreCase);
  const limit = Math.max(1, params.limit || DEFAULT_CURSOR_GREP_LIMIT);
  const contextLines = Math.min(MAX_CURSOR_GREP_CONTEXT_LINES, Math.max(0, Math.floor(params.context || 0)));
  const files = await collectLocalFiles(searchPath, searchPath, params.glob, signal);
  const outputLines: string[] = [];
  let matchCount = 0;
  let limitReached = false;

  for (const filePath of files) {
    if (matchCount >= limit) {
      limitReached = true;
      break;
    }
    const content = await readFile(filePath, "utf8").catch(() => undefined);
    if (content === undefined) continue;
    const displayPath = searchInfo.isDirectory()
      ? toPosixPath(relative(searchPath, filePath))
      : toPosixPath(relative(cwd, filePath));
    const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      throwIfAborted(signal);
      const line = lines[index];
      const matched = params.literal
        ? (ignoreCase ? line.toLowerCase() : line).includes(literalPattern)
        : matcher!.test(line);
      if (!matched) continue;

      const start = Math.max(0, index - contextLines);
      const end = Math.min(lines.length - 1, index + contextLines);
      for (let current = start; current <= end; current += 1) {
        const isMatchLine = current === index;
        const separator = isMatchLine ? ":" : "-";
        outputLines.push(`${displayPath}${separator}${current + 1}${separator} ${lines[current]}`);
      }

      matchCount++;
      if (matchCount >= limit) {
        limitReached = true;
        break;
      }
    }
  }

  if (matchCount === 0) {
    return { content: [{ type: "text", text: "No matches found" }], details: undefined };
  }

  let text = outputLines.join("\n");
  const details: { matchLimitReached?: number } = {};
  if (limitReached) {
    text += `\n\n[${limit} matches limit reached]`;
    details.matchLimitReached = limit;
  }

  return { content: [{ type: "text", text }], details: Object.keys(details).length ? details : undefined };
}