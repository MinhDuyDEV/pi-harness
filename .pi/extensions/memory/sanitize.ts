/**
 * Secret sanitization for the memory capture pipeline.
 * Strips API keys, tokens, passwords, and credentials before storing.
 * Inspired by CASS memory system's sanitize.ts.
 */

// ---------------------------------------------------------------------------
// Pattern Battery
// ---------------------------------------------------------------------------

interface SanitizationRule {
	name: string;
	pattern: RegExp;
	replacement: string;
}

const RULES: SanitizationRule[] = [
	// API Keys (common providers)
	{
		name: "OpenAI API Key",
		pattern: /sk-[A-Za-z0-9_-]{20,}/g,
		replacement: "[REDACTED:openai-key]",
	},
	{
		name: "Anthropic API Key",
		pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g,
		replacement: "[REDACTED:anthropic-key]",
	},
	{
		name: "Google API Key",
		pattern: /AIza[A-Za-z0-9_-]{35}/g,
		replacement: "[REDACTED:google-key]",
	},
	{
		name: "AWS Access Key",
		pattern: /AKIA[A-Z0-9]{16}/g,
		replacement: "[REDACTED:aws-key]",
	},
	{
		name: "AWS Secret Key",
		pattern:
			/(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/g,
		replacement: "[REDACTED:aws-secret]",
	},
	{
		name: "GitHub PAT (classic)",
		pattern: /ghp_[A-Za-z0-9]{36}/g,
		replacement: "[REDACTED:github-pat]",
	},
	{
		name: "GitHub PAT (fine-grained)",
		pattern: /github_pat_[A-Za-z0-9_]{82}/g,
		replacement: "[REDACTED:github-pat-fg]",
	},
	{
		name: "GitHub OAuth",
		pattern: /gho_[A-Za-z0-9]{36}/g,
		replacement: "[REDACTED:github-oauth]",
	},
	{
		name: "Supabase Key",
		pattern: /sbp_[A-Za-z0-9]{40,}/g,
		replacement: "[REDACTED:supabase-key]",
	},
	{
		name: "Stripe Key",
		pattern: /(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{24,}/g,
		replacement: "[REDACTED:stripe-key]",
	},
	{
		name: "Figma Token",
		pattern: /figd_[A-Za-z0-9_-]{40,}/g,
		replacement: "[REDACTED:figma-token]",
	},

	// Generic patterns
	{
		name: "JWT Token",
		pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
		replacement: "[REDACTED:jwt]",
	},
	{
		name: "Bearer Token",
		pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
		replacement: "Bearer [REDACTED:token]",
	},
	{
		name: "Generic Secret Assignment",
		pattern:
			/(?:password|secret|token|api_key|apikey|api-key|private_key)\s*[=:]\s*['"]([^'"]{8,})['"](?!\s*[=:])/gi,
		replacement: "[REDACTED:secret]",
	},

	// Environment variable patterns (commonly seen in tool output)
	{
		name: "Env var export",
		pattern:
			/export\s+(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|DATABASE_URL|REDIS_URL)\s*=\s*['"]?([^\s'"]+)['"]?/gi,
		replacement: "export $1=[REDACTED]",
	},

	// Connection strings with credentials
	{
		name: "Database URL with password",
		pattern:
			/(?:postgres|mysql|mongodb|redis):\/\/[^:]+:([^@]{8,})@/gi,
		replacement: (match: string) =>
			match.replace(/:([^@]{8,})@/, ":[REDACTED]@"),
	},
];

// ---------------------------------------------------------------------------
// Sanitization Function
// ---------------------------------------------------------------------------

/**
 * Remove secrets from text before storage.
 * Returns sanitized text and count of redactions made.
 */
export function sanitize(text: string): {
	text: string;
	redactions: number;
} {
	let redactions = 0;
	let result = text;

	for (const rule of RULES) {
		const before = result;
		if (typeof rule.replacement === "function") {
			result = result.replace(rule.pattern, rule.replacement as any);
		} else {
			result = result.replace(rule.pattern, rule.replacement);
		}
		// Reset regex lastIndex for global patterns
		rule.pattern.lastIndex = 0;

		if (result !== before) {
			// Count matches (rough — at least 1 redaction per rule that matched)
			redactions++;
		}
	}

	return { text: result, redactions };
}
