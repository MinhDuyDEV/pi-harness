/**
 * process-tracker.ts — Background process management for tasks.
 *
 * Tracks spawned child processes, buffers their output, and supports
 * blocking wait and graceful stop (SIGTERM → 5s → SIGKILL).
 */
import type { ChildProcess } from "node:child_process";
import type { BackgroundProcess } from "./types.js";
export interface ProcessOutput {
    output: string;
    status: BackgroundProcess["status"];
    exitCode?: number;
    startedAt: number;
    completedAt?: number;
    command?: string;
}
export declare class ProcessTracker {
    private processes;
    /** Register a spawned process for a task. */
    track(taskId: string, proc: ChildProcess, command?: string): void;
    /** Get current output and status for a task's process. */
    getOutput(taskId: string): ProcessOutput | undefined;
    /** Wait for a task's process to complete, with timeout. */
    waitForCompletion(taskId: string, timeout: number, signal?: AbortSignal): Promise<ProcessOutput | undefined>;
    /** Stop a task's background process. SIGTERM → 5s → SIGKILL. */
    stop(taskId: string): Promise<boolean>;
    /** Get the process record for a task. */
    getProcess(taskId: string): BackgroundProcess | undefined;
}
