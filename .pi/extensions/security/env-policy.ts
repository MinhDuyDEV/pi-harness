const BASE_ENV_ALLOWLIST = [
	"HOME",
	"PATH",
	"PWD",
	"SHELL",
	"SHLVL",
	"TMP",
	"TEMP",
	"TMPDIR",
	"USER",
	"LOGNAME",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"COLORTERM",
	"NO_COLOR",
	"FORCE_COLOR",
	"CI",
	"XDG_CACHE_HOME",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_RUNTIME_DIR",
] as const;

const POLICY_ENV_ALLOWLIST = {
	stitch: ["STITCH_API_KEY", "STITCH_ACCESS_TOKEN", "GOOGLE_CLOUD_PROJECT"] as const,
	// srcwalk is a compiled binary — no npm env vars needed; binary path resolved from PATH or PI_SRCWALK_BIN
	srcwalk: [] as const,
	webclaw: ["WEBCLAW_BIN", "WEBCLAW_API_KEY", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"] as const,
} as const;

export type EnvPolicyName = keyof typeof POLICY_ENV_ALLOWLIST;

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

export function readCredential(name: string): string | undefined {
	const value = process.env[name];
	return isNonEmptyString(value) ? value.trim() : undefined;
}

export function buildSubprocessEnv(
	policy: EnvPolicyName,
	overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
	const result: NodeJS.ProcessEnv = {};
	const keys = new Set<string>([
		...BASE_ENV_ALLOWLIST,
		...POLICY_ENV_ALLOWLIST[policy],
		...Object.keys(overrides),
	]);

	for (const key of keys) {
		const override = overrides[key];
		if (override !== undefined) {
			result[key] = override;
			continue;
		}
		const current = process.env[key];
		if (current !== undefined) result[key] = current;
	}

	return result;
}
