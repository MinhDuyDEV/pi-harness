import { execFileSync } from "node:child_process";
import { join } from "node:path";

const TMUX_CONFIG_HINT = "Recommended ~/.tmux.conf: set -g extended-keys on; set -g extended-keys-format csi-u; then restart tmux.";

export interface HarnessTmuxWatch {
	sessionName?: string;
	attachCommand?: string;
	warning?: string;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function sessionSafe(value: string): string {
	const safe = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
	return safe || "pi-harness";
}

function runTmux(args: string[]): void {
	execFileSync("tmux", args, { stdio: "ignore" });
}

function paneCommand(script: string): string {
	return `bash -lc ${shellQuote(script)}`;
}

function tmuxVersionWarning(versionOutput: string): string | undefined {
	const match = versionOutput.match(/tmux\s+(\d+)\.(\d+)/i);
	if (!match) return `Could not parse tmux version from "${versionOutput.trim()}". ${TMUX_CONFIG_HINT}`;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	if (major < 3 || (major === 3 && minor < 2)) {
		return `tmux ${major}.${minor} detected; Pi tmux support expects tmux 3.2+. ${TMUX_CONFIG_HINT}`;
	}
	return TMUX_CONFIG_HINT;
}

export function startHarnessTmuxWatch(projectRoot: string, runDir: string, runId: string): HarnessTmuxWatch {
	let warning: string | undefined;
	try {
		const versionOutput = execFileSync("tmux", ["-V"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
		warning = tmuxVersionWarning(versionOutput);
	} catch {
		return { warning: "tmux was not found; harness watch panes were not started." };
	}

	const sessionName = sessionSafe(`pi-harness-${runId}`);
	if (process.env.TMUX) {
		return { sessionName: "current window" };
	}

	const eventsPath = join(runDir, "EVENTS.ndjson");
	const progressPath = join(runDir, "PROGRESS.md");
	const specPath = join(runDir, "SPEC.md");
	const reportPath = join(runDir, "BUILD-REPORT.md");
	const usagePath = join(runDir, "USAGE.json");
	const promptsPath = join(runDir, "PROMPTS");

	try {
		runTmux(["has-session", "-t", sessionName]);
		return { sessionName, attachCommand: `tmux attach -t ${sessionName}`, warning };
	} catch {
		// Expected for a new run.
	}

	const eventsScript = [
		"printf '\\033]2;Harness events\\033\\\\'",
		`echo ${shellQuote(`Harness event log: ${eventsPath}`)}`,
		"echo 'Attach here to watch what each planner/worker/reviewer session is doing.'",
		`echo ${shellQuote(warning ?? "")}`,
		"echo",
		`touch ${shellQuote(eventsPath)}`,
		`tail -n +1 -F ${shellQuote(eventsPath)}`,
	].join("; ");

	const overviewScript = [
		"printf '\\033]2;Harness overview\\033\\\\'",
		"while true; do",
		"clear",
		`echo ${shellQuote(`Harness artifacts: ${runDir}`)}`,
		"echo",
		`for f in ${shellQuote(specPath)} ${shellQuote(progressPath)} ${shellQuote(reportPath)} ${shellQuote(usagePath)}; do`,
		"  echo '===== '$(basename \"$f\")' ====='",
		"  if [ -f \"$f\" ]; then tail -n 80 \"$f\"; else echo '(waiting)'; fi",
		"  echo",
		"done",
		"echo '===== PROMPTS ====='",
		`if [ -d ${shellQuote(promptsPath)} ]; then find ${shellQuote(promptsPath)} -maxdepth 1 -type f -print | sort | xargs -r -n1 basename; else echo '(waiting)'; fi`,
		"sleep 2",
		"done",
	].join("; ");

	const outputsScript = [
		"printf '\\033]2;Harness outputs\\033\\\\'",
		"while true; do",
		"clear",
		`echo ${shellQuote(`Latest agent outputs under: ${runDir}`)}`,
		"echo",
		`find ${shellQuote(runDir)} -name OUTPUT.md -type f | sort | while read -r f; do`,
		"  echo '===== '$(realpath --relative-to=. \"$f\" 2>/dev/null || echo \"$f\")' ====='",
		"  tail -n 80 \"$f\"",
		"  echo",
		"done",
		"sleep 2",
		"done",
	].join("; ");

	try {
		runTmux(["new-session", "-d", "-s", sessionName, "-c", projectRoot, paneCommand(eventsScript)]);
		runTmux(["split-window", "-h", "-t", sessionName, "-c", projectRoot, paneCommand(overviewScript)]);
		runTmux(["split-window", "-v", "-t", `${sessionName}:0.1`, "-c", projectRoot, paneCommand(outputsScript)]);
		runTmux(["select-layout", "-t", sessionName, "tiled"]);
	} catch (error) {
		return {
			warning: `tmux watch failed to start: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	return { sessionName, attachCommand: `tmux attach -t ${sessionName}`, warning };
}
