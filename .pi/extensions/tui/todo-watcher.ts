import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import { findCanonicalTodo } from "./todos-panel.js";

export interface TodoFileWatcher {
  watch(cwd: string, ctx: ExtensionContext): void;
  refresh(cwd: string, source: string, ctx: ExtensionContext): Promise<void>;
  dispose(): void;
}

export function createTodoFileWatcher(
  refreshTodos: (cwd: string) => Promise<number>,
  scheduleRefresh: (ctx: ExtensionContext) => void,
): TodoFileWatcher {
  let watcher: FSWatcher | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let lastOpenCount = -1;

  const dispose = (): void => {
    watcher?.close();
    watcher = null;
    if (debounce) clearTimeout(debounce);
    debounce = null;
  };

  const refresh = async (cwd: string, source: string, ctx: ExtensionContext): Promise<void> => {
    const openCount = await refreshTodos(cwd);
    if (openCount === lastOpenCount) return;
    lastOpenCount = openCount;
    try {
      ctx.ui.notify(`Todo list refreshed (${openCount} open, via ${source})`, "info");
    } catch {
      return;
    }
  };

  const watchTodo = (cwd: string, ctx: ExtensionContext): void => {
    dispose();
    const todoPath = findCanonicalTodo(cwd);
    if (!todoPath) return;
    const target = basename(todoPath);
    try {
      watcher = watch(dirname(todoPath), (_eventType, filename) => {
        if (!filename || filename !== target) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          debounce = null;
          void refresh(cwd, "file-watch", ctx);
          scheduleRefresh(ctx);
        }, 100);
      });
    } catch {
      watcher = null;
    }
  };

  return { watch: watchTodo, refresh, dispose };
}
