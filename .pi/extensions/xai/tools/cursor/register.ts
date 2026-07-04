import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { rm } from "fs/promises";
import { resolveXaiAuthToken } from "../../auth";
import { DEFAULT_XAI_MODEL } from "../../constants";
import { createXaiResponse } from "../../responses";
import { extractResponsesText, messageFromError, statusFromError } from "../../text";
import { xaiToolError } from "../common";
import { firstString, objectFromCursorArgs } from "./coerce";
import {
  normalizeDeleteArgs,
  normalizeEditArgs,
  normalizeGlobArgs,
  normalizeGrepArgs,
  normalizeLsArgs,
  normalizeReadArgs,
  normalizeShellArgs,
  normalizeWriteArgs,
  safeWorkspacePath,
} from "./normalize";
import { localFindOperations, runLocalGrep } from "./search";

function registerFileTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "Read",
    label: "Read",
    description: "Cursor/Grok CLI compatibility shim for pi's read tool. Reads a file by path/file_path with optional offset and limit.",
    promptSnippet: "Cursor-style alias for read; accepts path/file_path plus optional offset/limit",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to read" },
        file_path: { type: "string", description: "Cursor-style alias for path" },
        offset: { type: "number", description: "1-indexed line offset" },
        limit: { type: "number", description: "Maximum lines to read" },
      },
    },
    prepareArguments: normalizeReadArgs,
    execute: async (toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) => {
      return createReadToolDefinition(ctx.cwd).execute(toolCallId, normalizeReadArgs(params) as any, signal, onUpdate, ctx);
    },
  } as any);

  pi.registerTool({
    name: "Write",
    label: "Write",
    description: "Cursor/Grok CLI compatibility shim for pi's write tool. Writes content/contents to path/file_path.",
    promptSnippet: "Cursor-style alias for write; accepts path/file_path and content/contents",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to write" },
        file_path: { type: "string", description: "Cursor-style alias for path" },
        content: { type: "string", description: "Content to write" },
        contents: { type: "string", description: "Cursor-style alias for content" },
      },
    },
    prepareArguments: normalizeWriteArgs,
    execute: async (toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) => {
      return createWriteToolDefinition(ctx.cwd).execute(toolCallId, normalizeWriteArgs(params) as any, signal, onUpdate, ctx);
    },
  } as any);

  const editToolBase = {
    prepareArguments: normalizeEditArgs,
    execute: async (toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) => {
      return createEditToolDefinition(ctx.cwd).execute(toolCallId, normalizeEditArgs(params) as any, signal, onUpdate, ctx);
    },
  };

  pi.registerTool({
    name: "StrReplace",
    label: "StrReplace",
    description: "Cursor/Grok CLI compatibility shim for exact string replacement. Accepts old_string/new_string or oldText/newText.",
    promptSnippet: "Cursor-style exact string replacement; accepts old_string/new_string",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to edit" },
        file_path: { type: "string", description: "Cursor-style alias for path" },
        old_string: { type: "string", description: "Text to replace" },
        new_string: { type: "string", description: "Replacement text" },
        oldText: { type: "string", description: "pi-style alias for old_string" },
        newText: { type: "string", description: "pi-style alias for new_string" },
      },
    },
    ...editToolBase,
  } as any);

  pi.registerTool({
    name: "Edit",
    label: "Edit",
    description: "Cursor/Grok CLI compatibility shim for pi's edit tool. Accepts edits or old_string/new_string aliases.",
    promptSnippet: "Cursor-style alias for edit; accepts edits or old_string/new_string",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to edit" },
        file_path: { type: "string", description: "Cursor-style alias for path" },
        edits: { type: "array", description: "Array of { oldText/old_string, newText/new_string } replacements" },
        old_string: { type: "string", description: "Text to replace" },
        new_string: { type: "string", description: "Replacement text" },
      },
    },
    ...editToolBase,
  } as any);

  pi.registerTool({
    name: "Delete",
    label: "Delete",
    description: "Cursor/Grok CLI compatibility shim for deleting a workspace file. Directories require recursive=true.",
    promptSnippet: "Cursor-style delete for workspace files; directories require recursive=true",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to delete" },
        file_path: { type: "string", description: "Cursor-style alias for path" },
        recursive: { type: "boolean", description: "Allow recursive directory deletion" },
      },
    },
    prepareArguments: normalizeDeleteArgs,
    execute: async (_toolCallId: string, params: any, signal: any, _onUpdate: any, ctx: any) => {
      if (signal?.aborted) throw new Error("Operation aborted");
      const { path, recursive } = normalizeDeleteArgs(params);
      if (!path) throw new Error("Delete requires a path");
      const absolutePath = safeWorkspacePath(ctx.cwd, path);
      await rm(absolutePath, { recursive: !!recursive, force: false });
      return { content: [{ type: "text", text: `Deleted ${path}` }], details: undefined };
    },
  } as any);

  pi.registerTool({
    name: "LS",
    label: "LS",
    description: "Cursor/Grok CLI compatibility shim for pi's ls tool. Lists files under path.",
    promptSnippet: "Cursor-style alias for ls; lists files under path",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory or file path" },
        limit: { type: "number", description: "Maximum entries to return" },
      },
    },
    prepareArguments: normalizeLsArgs,
    execute: async (toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) => {
      return createLsToolDefinition(ctx.cwd).execute(toolCallId, normalizeLsArgs(params) as any, signal, onUpdate, ctx);
    },
  } as any);
}

function registerSearchAndShellTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "Grep",
    label: "Grep",
    description: "Cursor/Grok CLI compatibility shim for pi's grep tool. Accepts pattern/query plus include/glob filters.",
    promptSnippet: "Cursor-style alias for grep; accepts pattern/query and include/glob filters",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex or literal search pattern" },
        query: { type: "string", description: "Cursor-style alias for pattern" },
        path: { type: "string", description: "Directory or file to search" },
        include: { type: "string", description: "Glob filter, e.g. *.ts" },
        glob: { type: "string", description: "Glob filter, e.g. *.ts" },
        glob_filter: { type: "string", description: "Cursor-style alias for glob" },
        ignoreCase: { type: "boolean", description: "Case-insensitive search" },
        limit: { type: "number", description: "Maximum matches" },
      },
    },
    prepareArguments: normalizeGrepArgs,
    execute: async (_toolCallId: string, params: any, signal: any, _onUpdate: any, ctx: any) => {
      return runLocalGrep(ctx.cwd, normalizeGrepArgs(params), signal);
    },
  } as any);

  pi.registerTool({
    name: "Glob",
    label: "Glob",
    description: "Cursor/Grok CLI compatibility shim for pi's find tool. Finds files matching pattern/glob.",
    promptSnippet: "Cursor-style alias for find; accepts pattern/glob",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern, e.g. **/*.ts" },
        glob: { type: "string", description: "Cursor-style alias for pattern" },
        path: { type: "string", description: "Directory to search" },
        limit: { type: "number", description: "Maximum results" },
      },
    },
    prepareArguments: normalizeGlobArgs,
    execute: async (toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) => {
      return createFindToolDefinition(ctx.cwd, { operations: localFindOperations }).execute(
        toolCallId,
        normalizeGlobArgs(params) as any,
        signal,
        onUpdate,
        ctx,
      );
    },
  } as any);

  pi.registerTool({
    name: "Shell",
    label: "Shell",
    description: "Cursor/Grok CLI compatibility shim for pi's bash tool. Executes command/cmd in the workspace shell.",
    promptSnippet: "Cursor-style alias for bash; executes command/cmd in the workspace shell",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        cmd: { type: "string", description: "Alias for command" },
        timeout: { type: "number", description: "Timeout in milliseconds" },
      },
    },
    prepareArguments: normalizeShellArgs,
    execute: async (toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) => {
      return createBashToolDefinition(ctx.cwd).execute(toolCallId, normalizeShellArgs(params) as any, signal, onUpdate, ctx);
    },
  } as any);

  pi.registerTool({
    name: "WebSearch",
    label: "WebSearch",
    description: "Cursor/Grok CLI compatibility shim for xAI web search. Searches the web with xAI's native web_search tool.",
    promptSnippet: "Cursor-style web search backed by xAI native web_search",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        search_term: { type: "string", description: "Alias for query" },
      },
    },
    prepareArguments: (args: unknown) => {
      const params = objectFromCursorArgs(args);
      return { query: firstString(params.query, params.search_term, params.value) || "" };
    },
    execute: async (_toolCallId: string, params: any, signal: any, _onUpdate: any, ctx: any) => {
      const query = firstString(params?.query, params?.search_term, params?.value);
      if (!query) return xaiToolError("Error: WebSearch requires a query.");
      const apiKey = await resolveXaiAuthToken(ctx);
      if (!apiKey) return xaiToolError("Error: No xAI OAuth credentials found. Please run the OAuth login first.");

      try {
        const data = await createXaiResponse(
          apiKey,
          {
            model: DEFAULT_XAI_MODEL,
            input: `Search the web for: ${query}\n\nSummarize the key results with sources where available.`,
            tools: [{ type: "web_search", enable_image_understanding: true }],
          },
          signal,
        );
        return { content: [{ type: "text", text: extractResponsesText(data) }], details: { response_id: data.id } };
      } catch (error) {
        const status = statusFromError(error);
        return xaiToolError(`xAI API Error${status ? ` ${status}` : ""}: ${messageFromError(error)}`, { error: true, status });
      }
    },
  } as any);
}

/** Register Cursor/Grok CLI compatibility shims. */
export function registerCursorToolShims(pi: ExtensionAPI) {
  registerFileTools(pi);
  registerSearchAndShellTools(pi);
}