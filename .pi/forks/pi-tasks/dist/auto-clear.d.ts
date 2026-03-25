/**
 * auto-clear.ts — Turn-based auto-clearing of completed tasks.
 *
 * Two modes:
 * - "on_task_complete": each completed task gets its own REMINDER_INTERVAL countdown, deleted individually
 * - "on_list_complete": countdown starts when ALL tasks are completed, cleared as a batch
 *
 * Both use the same turn delay (REMINDER_INTERVAL) for consistency.
 */
import type { TaskStore } from "./task-store.js";
export type AutoClearMode = "never" | "on_list_complete" | "on_task_complete";
export declare class AutoClearManager {
    private getStore;
    private getMode;
    /** How many turns completed tasks linger before auto-clearing. */
    private clearDelayTurns;
    /** Per-task: turn when task was marked completed ("on_task_complete" mode). */
    private completedAtTurn;
    /** Turn when ALL tasks became completed ("on_list_complete" mode). */
    private allCompletedAtTurn;
    constructor(getStore: () => TaskStore, getMode: () => AutoClearMode, 
    /** How many turns completed tasks linger before auto-clearing. */
    clearDelayTurns?: number);
    /** Record a task completion. Call AFTER cascade logic. */
    trackCompletion(taskId: string, currentTurn: number): void;
    /** Check if all tasks are completed and start/reset the batch countdown. */
    private checkAllCompleted;
    /** Reset batch countdown (e.g., when a new task is created or task goes non-completed). */
    resetBatchCountdown(): void;
    /** Reset all tracking state (e.g., on new session). */
    reset(): void;
    /**
     * Called on each turn start. Deletes tasks whose linger period has expired.
     * Returns true if any tasks were cleared.
     */
    onTurnStart(currentTurn: number): boolean;
}
