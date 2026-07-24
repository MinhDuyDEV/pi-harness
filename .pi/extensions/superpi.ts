import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EXTREMELY_IMPORTANT_MARKER = "<EXTREMELY-IMPORTANT>";
const BOOTSTRAP_MARKER = "pikit:superpi bootstrap";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(extensionDir, "../..");
const skillsDir = resolve(packageRoot, ".pi", "skills");
const bootstrapSkillPath = resolve(skillsDir, "superpi", "SKILL.md");

/** Absolute path to the bootstrap skill this extension injects. Exposed for tests. */
export function getBootstrapSkillPath(): string {
	return bootstrapSkillPath;
}

let cachedBootstrap: string | null | undefined;

/** Strip YAML frontmatter and trim leading whitespace. */
export function stripFrontmatter(content: string): string {
	const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
	return (match ? match[1] : content).trim();
}

/** Does this message contain the bootstrap marker? Accepts string or array content. */
export function messageContainsBootstrap(message: unknown, marker: string): boolean {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content.includes(marker);
	if (!Array.isArray(content)) return false;
	return content.some((part) => {
		return (
			part &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "text" &&
			typeof (part as { text?: unknown }).text === "string" &&
			(part as { text: string }).text.includes(marker)
		);
	});
}

/** Index of the first message that is NOT a compaction summary. */
export function firstNonCompactionSummaryIndex(messages: unknown[]): number {
	let index = 0;
	while ((messages[index] as { role?: unknown } | undefined)?.role === "compactionSummary") {
		index += 1;
	}
	return index;
}

function getBootstrapContent(): string | null {
	if (cachedBootstrap !== undefined) return cachedBootstrap;

	try {
		const skillContent = readFileSync(bootstrapSkillPath, "utf8");
		const body = stripFrontmatter(skillContent);
		cachedBootstrap = `${EXTREMELY_IMPORTANT_MARKER}
${BOOTSTRAP_MARKER}

You have pikit skills.

The superpi content is included below and is already loaded for this Pi session. Follow it now. Do not try to load superpi again.

${body}
${EXTREMELY_IMPORTANT_MARKER}`;
		return cachedBootstrap;
	} catch {
		cachedBootstrap = null;
		return null;
	}
}

export default function superpiExtension(pi: ExtensionAPI) {
	let injectBootstrap = true;

	pi.on("resources_discover", async () => ({
		skillPaths: [skillsDir],
	}));

	pi.on("session_start", async () => {
		injectBootstrap = true;
	});

	pi.on("session_compact", async () => {
		injectBootstrap = true;
	});

	pi.on("agent_end", async () => {
		injectBootstrap = false;
	});

	pi.on("context", async (event) => {
		// Opt-out: PIKIT_NO_SUPERPI=1 disables bootstrap injection entirely.
		// The ~247-token routing guidance is on by default; consumers who want only
		// the skills/extensions without the forced bootstrap can opt out here.
		if (process.env.PIKIT_NO_SUPERPI === "1" || process.env.PIKIT_NO_SUPERPI === "true") return;
		if (!injectBootstrap) return;
		if (event.messages.some((m) => messageContainsBootstrap(m, BOOTSTRAP_MARKER))) return;

		const bootstrap = getBootstrapContent();
		if (!bootstrap) return;

		const bootstrapMessage = {
			role: "user" as const,
			content: [{ type: "text" as const, text: bootstrap }],
			timestamp: Date.now(),
		};

		const insertAt = firstNonCompactionSummaryIndex(event.messages);
		return {
			messages: [
				...event.messages.slice(0, insertAt),
				bootstrapMessage,
				...event.messages.slice(insertAt),
			],
		};
	});
}
