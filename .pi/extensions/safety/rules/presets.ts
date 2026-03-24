/**
 * Safety Rules — Presets
 *
 * Default rule composition. One function to get all rules.
 */

import { merge } from "../compose.js";
import type { RuleSet } from "../types.js";
import { credentialRules } from "./credentials.js";
import { destructiveRules } from "./destructive.js";
import { gitRules } from "./git.js";
import { networkRules } from "./network.js";
import { publishRules } from "./publish.js";
import { systemRules } from "./system.js";
import { VerificationTracker, verificationRules } from "./verification.js";
import { workspaceRules } from "./workspace.js";

export interface PresetConfig {
	additionalProtectedPaths?: string[];
}

export function defaultRules(
	config?: PresetConfig,
	tracker?: VerificationTracker,
): { rules: RuleSet; tracker: VerificationTracker } {
	const vt = tracker ?? new VerificationTracker();
	const rules = merge(
		gitRules,
		credentialRules,
		destructiveRules,
		publishRules,
		systemRules,
		networkRules,
		workspaceRules(config),
		verificationRules(vt),
	);
	return { rules, tracker: vt };
}
