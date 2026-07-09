/**
 * Shared Utilities — Cross-Extension Helpers
 *
 * Consolidates patterns duplicated across extensions:
     *   - isAbortError (shared by deepseek/retry.ts)
     *   - runChildProcess / abortOnSignal (shared child-process helpers)
 */

import { execFile, type ChildProcess } from "node:child_process";

/** Parse simple YAML frontmatter from agent markdown files. */
export function parseMarkdownFrontmatter(
	content: string,
): { frontmatter: Record<string, string>; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) return { frontmatter: {}, body: content.trim() };

	const raw = match[1];
	const body = match[2].trim();
	const frontmatter: Record<string, string> = {};

	for (const line of raw.split("\n")) {
		const kvMatch = line.match(/^\s*(\w[\w_-]*)\s*:\s*(.*?)\s*$/);
		if (kvMatch) {
			frontmatter[kvMatch[1]] = kvMatch[2].replace(/^["']|["']$/g, "");
		}
	}

	return { frontmatter, body };
}

/**
 * Detect abort errors across different runtime shapes.
 * Covers DOMException (AbortError), Node error codes (ABORT_ERR),
 * and TimeoutError from various libraries.
 */
export function isAbortError(err: unknown): boolean {
	if (!err || typeof err !== "object") return false;
	const candidate = err as { name?: string; code?: string } | undefined;
	return (
		candidate?.name === "AbortError" ||
		candidate?.code === "ABORT_ERR" ||
		candidate?.name === "TimeoutError"
	);
}

/**
 * Attach abort-signal handling to a child process.
 * Kills the child with SIGTERM when the signal fires.
 * Registered with { once: true } so it auto-removes after first fire.
 */
export function abortOnSignal(child: ChildProcess, signal: AbortSignal): void {
	const onAbort = () => {
		try {
			child.kill("SIGTERM");
		} catch {
			// best effort — process may already have exited
		}
	};
	signal.addEventListener("abort", onAbort, { once: true });
}

/**
 * Options for execFilePromise.
 */
export interface ExecFileOptions {
	bin: string;
	args: string[];
	env: Record<string, string | undefined>;
	timeoutMs?: number;
	maxBuffer?: number;
	signal?: AbortSignal;

	/**
	 * Optional custom error message when the binary is not found (ENOENT).
	 * If not provided, a generic "binary not found" error is thrown.
	 */
	onNotFound?: () => string;
}

/**
 * Run a binary via execFile and return its stdout as a trimmed string.
 *
 * Handles:
 *   - AbortError detection and propagation
 *   - ENOENT with customizable install instructions
 *   - stderr/error.message fallback for unknown errors
 *   - AbortSignal wiring (SIGTERM on abort)
 */
export function execFilePromise(options: ExecFileOptions): Promise<string> {
	const {
		bin,
		args,
		env,
		timeoutMs = 30_000,
		maxBuffer = 10 * 1024 * 1024,
		signal,
		onNotFound,
	} = options;

	return new Promise<string>((resolve, reject) => {
		const child = execFile(
			bin,
			args,
			{ env, timeout: timeoutMs, maxBuffer, signal },
			(error, stdout, stderr) => {
				if (error) {
					if (isAbortError(error)) {
						reject(new DOMException("Cancelled", "AbortError"));
						return;
					}

					if (
						(error as NodeJS.ErrnoException).code === "ENOENT" &&
						onNotFound
					) {
						reject(new Error(onNotFound()));
						return;
					}

					const stderrText = (stderr || "").trim();
					reject(
						new Error(
							stderrText ||
								error.message ||
								`${bin} failed: ${args.join(" ")}`,
						),
					);
					return;
				}

				resolve((stdout || "").trim());
			},
		);

		if (signal) {
			abortOnSignal(child, signal);
		}
	});
}
