/**
 * task-store.ts — File-backed task store with CRUD, dependency management, and file locking.
 *
 * Session-scoped (default): in-memory Map — no disk I/O.
 * Shared (PI_TASK_LIST_ID set): ~/.pi/tasks/<listId>.json with file locking.
 */
import type { Task, TaskStatus } from "./types.js";
export declare class TaskStore {
    private filePath;
    private lockPath;
    private nextId;
    private tasks;
    constructor(listIdOrPath?: string);
    /** Read store from disk (file-backed mode only). */
    private load;
    /** Write store to disk atomically (file-backed mode only). */
    private save;
    /** Execute a mutation with file locking (if file-backed). */
    private withLock;
    create(subject: string, description: string, activeForm?: string, metadata?: Record<string, any>): Task;
    get(id: string): Task | undefined;
    /** List all tasks sorted by ID ascending. */
    list(): Task[];
    update(id: string, fields: {
        status?: TaskStatus | "deleted";
        subject?: string;
        description?: string;
        activeForm?: string;
        owner?: string;
        metadata?: Record<string, any>;
        addBlocks?: string[];
        addBlockedBy?: string[];
    }): {
        task: Task | undefined;
        changedFields: string[];
        warnings: string[];
    };
    /** Delete a task by ID. Returns true if deleted. */
    delete(id: string): boolean;
    /** Remove all tasks. */
    clearAll(): number;
    /** Delete the backing file (if file-backed and empty). */
    deleteFileIfEmpty(): boolean;
    /** Remove all completed tasks. */
    clearCompleted(): number;
}
