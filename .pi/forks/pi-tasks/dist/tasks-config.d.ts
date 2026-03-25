export interface TasksConfig {
    taskScope?: "memory" | "session" | "project";
    autoCascade?: boolean;
    autoClearCompleted?: "never" | "on_list_complete" | "on_task_complete";
}
export declare function loadTasksConfig(): TasksConfig;
export declare function saveTasksConfig(config: TasksConfig): void;
