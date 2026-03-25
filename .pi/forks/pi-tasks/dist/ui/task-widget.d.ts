/**
 * task-widget.ts — Persistent widget showing task list with status icons and progress.
 *
 * Display style matches Claude Code's task list:
 *   ✔ completed tasks (strikethrough + dim)
 *   ◼ in_progress tasks
 *   ◻ pending tasks
 *   ✳/✽ actively executing task (star spinner with activeForm text)
 */
import type { TaskStore } from "../task-store.js";
export type Theme = {
    fg(color: string, text: string): string;
    bold(text: string): string;
    strikethrough(text: string): string;
};
export type UICtx = {
    setStatus(key: string, text: string | undefined): void;
    setWidget(key: string, content: undefined | ((tui: any, theme: Theme) => {
        render(): string[];
        invalidate(): void;
    }), options?: {
        placement?: "aboveEditor" | "belowEditor";
    }): void;
};
/** Per-task runtime metrics (elapsed time, token usage). */
export interface TaskMetrics {
    startedAt: number;
    inputTokens: number;
    outputTokens: number;
}
export declare class TaskWidget {
    private store;
    private uiCtx;
    private widgetFrame;
    private widgetInterval;
    /** IDs of tasks currently being actively executed (show spinner). */
    private activeTaskIds;
    /** Per-task runtime metrics keyed by task ID. */
    private metrics;
    /** Cached TUI instance for requestRender() calls. */
    private tui;
    /** Whether the widget callback is currently registered. */
    private widgetRegistered;
    constructor(store: TaskStore);
    setStore(store: TaskStore): void;
    setUICtx(ctx: UICtx): void;
    /** Add or remove a task from the active spinner set. */
    setActiveTask(taskId: string | undefined, active?: boolean): void;
    /** Record token usage for the currently active task(s). */
    addTokenUsage(inputTokens: number, outputTokens: number): void;
    /** Ensure the widget update timer is running. */
    ensureTimer(): void;
    /** Build widget lines from current live state. Called from the render callback. */
    private renderWidget;
    /** Force an immediate widget update. */
    update(): void;
    dispose(): void;
}
