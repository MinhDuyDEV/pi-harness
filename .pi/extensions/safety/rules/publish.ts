/**
 * Safety Rules — Registry Publish & Database Drop
 *
 * Ported from guardian.ts. 4 rules: npm/cargo publish,
 * docker prune, database drop.
 */

import { confirm, rule, type RuleSet } from "../types.js";

export const publishRules: RuleSet = [
	rule({
		id: "warn-npm-publish",
		description: "Publishing packages to public registry",
		severity: "high",
		threat: "registry-publish",
		targets: ["bash"],
		check: (ctx) =>
			/\b(npm|pnpm|yarn)\s+publish\b/.test(ctx.command!)
				? confirm("warn-npm-publish", "high", "registry-publish",
					"Package publish detected. This pushes code to a public registry — it cannot be easily unpublished.")
				: null,
	}),
	rule({
		id: "warn-cargo-publish",
		description: "Publishing Rust crate to crates.io",
		severity: "high",
		threat: "registry-publish",
		targets: ["bash"],
		check: (ctx) =>
			/\bcargo\s+publish\b/.test(ctx.command!)
				? confirm("warn-cargo-publish", "high", "registry-publish",
					"Crate publish detected. Once published to crates.io, versions cannot be removed.")
				: null,
	}),
	rule({
		id: "warn-docker-prune",
		description: "Docker system-wide cleanup",
		severity: "high",
		threat: "data-destruction",
		targets: ["bash"],
		check: (ctx) =>
			/\bdocker\s+(system\s+prune|volume\s+prune|container\s+prune)\b/.test(ctx.command!)
				? confirm("warn-docker-prune", "high", "data-destruction",
					"Docker prune detected. Data in unnamed volumes will be permanently lost.")
				: null,
	}),
	rule({
		id: "warn-database-drop",
		description: "Database drop operations",
		severity: "high",
		threat: "data-destruction",
		targets: ["bash"],
		check: (ctx) => {
			const cmd = ctx.command!;
			return /\bDROP\s+(DATABASE|TABLE|SCHEMA)\b/i.test(cmd) ||
				/\bpsql\b.*\bdrop\b/i.test(cmd) ||
				/\bmysql\b.*\bdrop\b/i.test(cmd)
				? confirm("warn-database-drop", "high", "data-destruction",
					"Database DROP detected. Ensure you have a backup before proceeding.")
				: null;
		},
	}),
];
