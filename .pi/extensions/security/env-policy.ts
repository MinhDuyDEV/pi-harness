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
	// srcwalk is a compiled binary; PI_SRCWALK_BIN is allowed so diagnostics and child processes keep the configured binary path.
	srcwalk: ["PI_SRCWALK_BIN"] as const,
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

function allowedEnvKeys(policy: EnvPolicyName): Set<string> {
	return new Set([
		...BASE_ENV_ALLOWLIST,
		...POLICY_ENV_ALLOWLIST[policy],
	]);
}

function assertAllowedOverrides(
	policy: EnvPolicyName,
	keys: Set<string>,
	overrides: Record<string, string | undefined>,
): void {
	for (const key of Object.keys(overrides)) {
		if (!keys.has(key)) throw new Error(`Environment override is not allowed by ${policy} policy: ${key}`);
	}
}

function envValue(key: string, overrides: Record<string, string | undefined>): string | undefined {
	return Object.hasOwn(overrides, key) ? overrides[key] : process.env[key];
}

export function buildSubprocessEnv(
	policy: EnvPolicyName,
	overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
	const result: NodeJS.ProcessEnv = {};
	const keys = allowedEnvKeys(policy);
	assertAllowedOverrides(policy, keys, overrides);

	for (const key of keys) {
		const value = envValue(key, overrides);
		if (value !== undefined) result[key] = value;
	}

	return result;
}
