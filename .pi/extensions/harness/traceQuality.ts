import { parseCriteriaItems, type Sprint, type SprintResult } from "./parsing.js";

export type TraceQualityLevel = "weak" | "ok" | "strong";

export interface SprintTraceQuality {
	sprint: number;
	title: string;
	level: TraceQualityLevel;
	score: number;
	maxScore: number;
	friction: string[];
}

export interface RunTraceQualitySummary {
	level: TraceQualityLevel;
	score: number;
	maxScore: number;
	friction: string[];
	items: SprintTraceQuality[];
}

function requiresDeterministicProof(sprint: Sprint): boolean {
	if (sprint.riskLane === "high-risk") return true;
	return sprint.proofRequired.some((item) => !/^(manual|manual review|review|none|n\/a)$/i.test(item.trim()));
}

function qualityLevel(score: number, maxScore: number, friction: readonly string[]): TraceQualityLevel {
	if (score >= maxScore && friction.length === 0) return "strong";
	if (score >= Math.ceil(maxScore * 0.6)) return "ok";
	return "weak";
}

export function assessSprintTrace(sprint: Sprint, result: SprintResult | undefined): SprintTraceQuality {
	const friction: string[] = [];
	let score = 0;
	const maxScore = 5;
	const prefix = `Sprint ${sprint.number} (${sprint.title})`;

	if (parseCriteriaItems(sprint.criteria).length > 0) score++;
	else friction.push(`${prefix}: missing parsed acceptance criteria.`);

	if (sprint.files.trim()) score++;
	else friction.push(`${prefix}: missing planned file ownership.`);

	if ((sprint.riskLane === "tiny" || sprint.contextNeeded.length > 0) && sprint.proofRequired.length > 0) score++;
	else friction.push(`${prefix}: missing context/proof planning metadata.`);

	const verificationStatus = result?.verification?.status ?? "skipped";
	const deterministicRequired = requiresDeterministicProof(sprint);
	if (verificationStatus === "passed") {
		score++;
	} else if ((verificationStatus === "skipped" || verificationStatus === "unverifiable") && !deterministicRequired) {
		score++;
	} else if (verificationStatus === "failed") {
		friction.push(`${prefix}: deterministic verification failed.`);
	} else if (deterministicRequired) {
		friction.push(`${prefix}: deterministic verification was required but not provided.`);
	}

	if (result?.passed) score++;
	else friction.push(`${prefix}: sprint did not pass all gates.`);

	return {
		sprint: sprint.number,
		title: sprint.title,
		level: qualityLevel(score, maxScore, friction),
		score,
		maxScore,
		friction,
	};
}

export function assessRunTrace(sprints: readonly Sprint[], results: readonly SprintResult[]): RunTraceQualitySummary {
	const items = sprints.map((sprint, index) => assessSprintTrace(sprint, results[index]));
	const score = items.reduce((total, item) => total + item.score, 0);
	const maxScore = items.reduce((total, item) => total + item.maxScore, 0);
	const friction = items.flatMap((item) => item.friction);
	return {
		level: qualityLevel(score, maxScore || 1, friction),
		score,
		maxScore,
		friction,
		items,
	};
}

export function formatTraceQualitySummary(summary: RunTraceQualitySummary): string {
	const header = `Trace quality: ${summary.level} (${summary.score}/${summary.maxScore})`;
	if (summary.friction.length === 0) return `${header}\nFriction: none`;
	return [header, "Friction:", ...summary.friction.map((item) => `- ${item}`)].join("\n");
}
