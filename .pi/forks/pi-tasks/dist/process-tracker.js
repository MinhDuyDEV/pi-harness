/**
 * process-tracker.ts — Background process management for tasks.
 *
 * Tracks spawned child processes, buffers their output, and supports
 * blocking wait and graceful stop (SIGTERM → 5s → SIGKILL).
 */
export class ProcessTracker {
    processes = new Map();
    /** Register a spawned process for a task. */
    track(taskId, proc, command) {
        const bp = {
            taskId,
            pid: proc.pid,
            command,
            output: [],
            status: "running",
            startedAt: Date.now(),
            proc,
            abortController: new AbortController(),
            waiters: [],
        };
        // Buffer stdout
        proc.stdout?.on("data", (data) => {
            bp.output.push(data.toString());
        });
        // Buffer stderr
        proc.stderr?.on("data", (data) => {
            bp.output.push(data.toString());
        });
        // Handle process exit
        proc.on("close", (code, _signal) => {
            if (bp.status === "running") {
                bp.status = code === 0 ? "completed" : "error";
            }
            bp.exitCode = code ?? undefined;
            bp.completedAt = Date.now();
            // Notify all waiters
            for (const resolve of bp.waiters)
                resolve();
            bp.waiters = [];
        });
        proc.on("error", (err) => {
            if (bp.status === "running") {
                bp.status = "error";
                bp.output.push(`Process error: ${err.message}`);
                bp.completedAt = Date.now();
                for (const resolve of bp.waiters)
                    resolve();
                bp.waiters = [];
            }
        });
        this.processes.set(taskId, bp);
    }
    /** Get current output and status for a task's process. */
    getOutput(taskId) {
        const bp = this.processes.get(taskId);
        if (!bp)
            return undefined;
        return {
            output: bp.output.join(""),
            status: bp.status,
            exitCode: bp.exitCode,
            startedAt: bp.startedAt,
            completedAt: bp.completedAt,
            command: bp.command,
        };
    }
    /** Wait for a task's process to complete, with timeout. */
    waitForCompletion(taskId, timeout, signal) {
        const bp = this.processes.get(taskId);
        if (!bp)
            return Promise.resolve(undefined);
        if (bp.status !== "running")
            return Promise.resolve(this.getOutput(taskId));
        return new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(finish, timeout);
            function finish() {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                resolve(self.getOutput(taskId));
            }
            const self = this;
            bp.waiters.push(finish);
            signal?.addEventListener("abort", finish, { once: true });
        });
    }
    /** Stop a task's background process. SIGTERM → 5s → SIGKILL. */
    async stop(taskId) {
        const bp = this.processes.get(taskId);
        if (!bp || bp.status !== "running")
            return false;
        bp.status = "stopped";
        bp.proc.kill("SIGTERM");
        // Wait up to 5s for graceful exit
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
                try {
                    bp.proc.kill("SIGKILL");
                }
                catch { /* already dead */ }
                resolve();
            }, 5000);
            bp.proc.on("close", () => {
                clearTimeout(timer);
                resolve();
            });
        });
        bp.completedAt = Date.now();
        for (const resolve of bp.waiters)
            resolve();
        bp.waiters = [];
        return true;
    }
    /** Get the process record for a task. */
    getProcess(taskId) {
        return this.processes.get(taskId);
    }
}
