import { spawnSync } from "node:child_process";
import { DEFAULT_HARNESS_POLICY, isCommandAllowed, type HarnessPolicy } from "./policy.js";
import type { VerificationCommandResult, VerificationSummary } from "./parsing.js";

function truncateOutput(value: string, max = 12_000): string {
	if (value.length <= max) return value;
	const half = Math.floor((max - 32) / 2);
	return `${value.slice(0, half)}\n… output truncated …\n${value.slice(-half)}`;
}

export function runVerificationCommands(
	commands: readonly string[],
	cwd: string,
	policy: HarnessPolicy = DEFAULT_HARNESS_POLICY,
): VerificationSummary {
	if (commands.length === 0) return { status: "skipped", results: [] };

	const results: VerificationCommandResult[] = [];
	for (const command of commands) {
		const allowed = isCommandAllowed(command, policy);
		if (!allowed.allowed) {
			results.push({
				command,
				allowed: false,
				exitCode: null,
				stdout: "",
				stderr: "",
				durationMs: 0,
				reason: `Command blocked by harness policy: ${allowed.reason ?? "blocked"}`,
			});
			continue;
		}

		const started = Date.now();
		const result = spawnSync(command, {
			cwd,
			shell: true,
			encoding: "utf-8",
			timeout: policy.verificationTimeoutMs,
			maxBuffer: 2 * 1024 * 1024,
		});
		results.push({
			command,
			allowed: true,
			exitCode: typeof result.status === "number" ? result.status : null,
			stdout: truncateOutput(result.stdout ?? ""),
			stderr: truncateOutput(result.stderr ?? result.error?.message ?? ""),
			durationMs: Date.now() - started,
			reason: result.error?.message,
		});
	}

	const failed = results.some((result) => !result.allowed || result.exitCode !== 0);
	return { status: failed ? "failed" : "passed", results };
}

export function formatVerificationSummary(summary: VerificationSummary): string {
	if (summary.status === "skipped") return "Verification commands: skipped (none provided).";
	return [
		`Verification commands: ${summary.status.toUpperCase()}`,
		...summary.results.map((result) => [
			`$ ${result.command}`,
			result.allowed ? `exit ${result.exitCode ?? "unknown"} (${result.durationMs}ms)` : result.reason ?? "blocked",
			result.stdout ? `stdout:\n${result.stdout}` : "",
			result.stderr ? `stderr:\n${result.stderr}` : "",
		].filter(Boolean).join("\n")),
	].join("\n\n");
}
