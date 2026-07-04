import { isAbsolute, relative, resolve } from "path";
import { firstBoolean, firstNumber, firstString, objectFromCursorArgs } from "./coerce";
import {
  cursorContent,
  cursorGlob,
  cursorNewText,
  cursorOldText,
  cursorPath,
  cursorSearchPattern,
} from "./fields";

/** Normalize arguments for the Cursor/Grok CLI Read shim. */
export function normalizeReadArgs(args: unknown) {
  const params = objectFromCursorArgs(args);
  return {
    path: cursorPath(params) || "",
    offset: firstNumber(params.offset, params.start_line, params.startLine),
    limit: firstNumber(params.limit, params.max_lines, params.maxLines),
  };
}

/** Normalize arguments for the Cursor/Grok CLI Write shim. */
export function normalizeWriteArgs(args: unknown) {
  const params = objectFromCursorArgs(args);
  return {
    path: cursorPath(params) || "",
    content: cursorContent(params) ?? "",
  };
}

/** Normalize arguments for the Cursor/Grok CLI Edit/StrReplace shims. */
export function normalizeEditArgs(args: unknown) {
  const params = objectFromCursorArgs(args);
  if (Array.isArray(params.edits)) {
    return {
      path: cursorPath(params) || "",
      edits: params.edits.map((edit: unknown) => {
        const item = objectFromCursorArgs(edit);
        return { oldText: cursorOldText(item) || "", newText: cursorNewText(item) ?? "" };
      }),
    };
  }
  return {
    path: cursorPath(params) || "",
    edits: [{ oldText: cursorOldText(params) || "", newText: cursorNewText(params) ?? "" }],
  };
}

/** Normalize arguments for the Cursor/Grok CLI Grep shim. */
export function normalizeGrepArgs(args: unknown) {
  const params = objectFromCursorArgs(args);
  return {
    pattern: cursorSearchPattern(params) || "",
    path: firstString(params.path, params.directory, params.dir, params.folder, params.file_path, params.filePath),
    glob: cursorGlob(params),
    ignoreCase: firstBoolean(params.ignoreCase, params.ignore_case, params.case_insensitive, params.caseInsensitive),
    literal: firstBoolean(params.literal, params.fixed_strings, params.fixedStrings),
    context: firstNumber(params.context, params.context_lines, params.contextLines),
    limit: firstNumber(params.limit, params.max_results, params.maxResults),
  };
}

/** Normalize arguments for the Cursor/Grok CLI Glob shim. */
export function normalizeGlobArgs(args: unknown) {
  const params = objectFromCursorArgs(args);
  return {
    pattern: firstString(params.pattern, params.glob, params.glob_pattern, params.globPattern, params.query, params.value) || "**/*",
    path: firstString(params.path, params.directory, params.dir, params.folder),
    limit: firstNumber(params.limit, params.max_results, params.maxResults),
  };
}

/** Normalize arguments for the Cursor/Grok CLI LS shim. */
export function normalizeLsArgs(args: unknown) {
  const params = objectFromCursorArgs(args);
  return {
    path: cursorPath(params),
    limit: firstNumber(params.limit, params.max_results, params.maxResults),
  };
}

/** Normalize arguments for the Cursor/Grok CLI Shell shim. */
export function normalizeShellArgs(args: unknown) {
  const params = objectFromCursorArgs(args);
  return {
    command: firstString(params.command, params.cmd, params.value) || "",
    timeout: firstNumber(params.timeout, params.timeout_ms, params.timeoutMs),
  };
}

/** Normalize arguments for the Cursor/Grok CLI Delete shim. */
export function normalizeDeleteArgs(args: unknown) {
  const params = objectFromCursorArgs(args);
  return {
    path: cursorPath(params) || "",
    recursive: firstBoolean(params.recursive, params.directory, params.dir),
  };
}

/** Resolve a requested path while refusing operations outside the workspace. */
export function safeWorkspacePath(cwd: string, requestedPath: string): string {
  const resolved = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(cwd, requestedPath);
  const workspace = resolve(cwd);
  const workspaceRelativePath = relative(workspace, resolved);
  if (workspaceRelativePath.startsWith("..") || isAbsolute(workspaceRelativePath)) {
    throw new Error(`Refusing to operate outside the workspace: ${requestedPath}`);
  }
  return resolved;
}