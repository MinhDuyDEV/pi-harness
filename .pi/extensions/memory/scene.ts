/**
 * L2 Scene Layer — Simple Concept Grouping
 *
 * Clusters observations by shared concepts. Single-pass grouping:
 * observations sharing ≥1 concept merge into the same scene.
 *
 * Scenes are DERIVED data, regenerated on each pipeline pass.
 * Stored in SQLite memory_files, keyed "scenes/{id}".
 */

import { MEMORY_CONFIG, type ObservationRow, type ObservationType } from "./config.js";
import { getMemoryDB } from "./db.js";
import { parseConcepts, TYPE_ICONS } from "./helpers.js";
import { upsertMemoryFile, getMemoryFile } from "./storage.js";

const SCENE_STORAGE_PREFIX = "scenes";

function cfg() { return MEMORY_CONFIG.scene; }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SceneObservationRef {
	id: number;
	type: ObservationType;
	title: string;
	concepts: string[];
	effective_score: number;
	created_at_epoch: number;
}

export interface SceneCluster {
	id: string;
	name: string;
	observations: SceneObservationRef[];
	averageScore: number;
	allConcepts: string[];
	firstObserved: number;
	lastObserved: number;
	patternType: string;
}

export interface SceneSummary {
	id: string;
	name: string;
	count: number;
	span: string;
	score: number;
}

// ---------------------------------------------------------------------------
// Clustering — single pass: group by shared concepts
// ---------------------------------------------------------------------------

export function buildScenes(): SceneCluster[] {
	const db = getMemoryDB();
	const rows = db
		.prepare(
			`SELECT id, type, title, concepts, effective_score, created_at_epoch
       FROM observations
       WHERE superseded_by IS NULL AND maturity != 'deprecated'
       ORDER BY created_at_epoch DESC`,
		)
		.all() as Array<{
			id: number; type: string; title: string; concepts: string | null;
			effective_score: number; created_at_epoch: number;
		}>;

	const obs: SceneObservationRef[] = rows
		.filter((r) => r.concepts)
		.map((r) => ({
			id: r.id,
			type: r.type as ObservationType,
			title: r.title,
			concepts: parseConcepts(r.concepts).map((c) => c.toLowerCase()),
			effective_score: r.effective_score,
			created_at_epoch: r.created_at_epoch,
		}));

	if (obs.length < cfg().minClusterSize) return [];

	// Single-pass Jaccard clustering
	const clusters: SceneObservationRef[][] = [];
	const assigned = new Set<number>();

	for (const base of obs) {
		if (assigned.has(base.id)) continue;
		const cluster = [base];
		assigned.add(base.id);
		const baseSet = new Set(base.concepts);

		for (const candidate of obs) {
			if (assigned.has(candidate.id)) continue;
			const candidateSet = new Set(candidate.concepts);
			let intersection = 0;
			for (const c of baseSet) if (candidateSet.has(c)) intersection++;
			const union = new Set([...baseSet, ...candidateSet]);
			const jaccard = union.size === 0 ? 0 : intersection / union.size;

			if (jaccard >= cfg().minJaccard) {
				cluster.push(candidate);
				assigned.add(candidate.id);
			}
		}

		if (cluster.length >= cfg().minClusterSize) clusters.push(cluster);
	}

	// Build SceneCluster objects
	return clusters.slice(0, cfg().maxScenes).map((group) => {
		const allConcepts = [...new Set(group.flatMap((o) => o.concepts))];
		const scores = group.map((o) => o.effective_score);
		const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
		const typeCounts = new Map<string, number>();
		for (const o of group) typeCounts.set(o.type, (typeCounts.get(o.type) ?? 0) + 1);
		const dominantType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "learning";
		const firstObs = Math.min(...group.map((o) => o.created_at_epoch));
		const lastObs = Math.max(...group.map((o) => o.created_at_epoch));
		const name = group.sort((a, b) => b.effective_score - a.effective_score)[0]?.title ?? "Work Pattern";

		// Stable-ish ID from sorted observation IDs
		const id = group.map((o) => o.id).sort((a, b) => a - b).join("-").slice(0, 80)
			+ "-" + allConcepts.slice(0, 2).map((c) => c.replace(/[^a-z0-9]/g, "").slice(0, 6)).join("-");

		return {
			id: id.replace(/[^a-z0-9_-]/g, "_"),
			name: name.length > 60 ? name.slice(0, 55) + "..." : name,
			observations: group,
			averageScore: avgScore,
			allConcepts,
			firstObserved: firstObs,
			lastObserved: lastObs,
			patternType: dominantType,
		};
	});
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

export function renderSceneToMarkdown(scene: SceneCluster): string {
	const lines = [
		`# ${scene.name}`,
		"",
		`- **Observations:** ${scene.observations.length}`,
		`- **Average score:** ${scene.averageScore.toFixed(2)}`,
		`- **Pattern type:** ${scene.patternType}`,
		`- **Concepts:** ${scene.allConcepts.slice(0, 10).join(", ")}`,
		`- **First observed:** ${new Date(scene.firstObserved).toISOString().slice(0, 10)}`,
		`- **Last observed:** ${new Date(scene.lastObserved).toISOString().slice(0, 10)}`,
		"",
		"### Observations",
		"",
	];
	for (const obs of scene.observations) {
		const icon = TYPE_ICONS[obs.type] ?? "📌";
		lines.push(`- ${icon} **#${obs.id}** [${obs.type}] ${obs.title} _(score: ${obs.effective_score.toFixed(2)})_`);
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function detectAndStoreScenes(): number {
	const scenes = buildScenes();
	clearSceneFiles();
	for (const scene of scenes) {
		upsertMemoryFile(`${SCENE_STORAGE_PREFIX}/${scene.id}`, renderSceneToMarkdown(scene), "replace");
	}
	return scenes.length;
}

export function listScenes(): SceneSummary[] {
	return buildScenes().map((s) => ({
		id: s.id,
		name: s.name,
		count: s.observations.length,
		span: s.firstObserved === s.lastObserved
			? new Date(s.firstObserved).toISOString().slice(0, 10)
			: `${new Date(s.firstObserved).toISOString().slice(0, 10)} → ${new Date(s.lastObserved).toISOString().slice(0, 10)}`,
		score: s.averageScore,
	}));
}

export function readScene(id: string): string | null {
	const row = getMemoryFile(`${SCENE_STORAGE_PREFIX}/${id}`);
	return row?.content ?? null;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function clearSceneFiles(): void {
	const db = getMemoryDB();
	db.prepare(`DELETE FROM memory_files WHERE file_path LIKE '${SCENE_STORAGE_PREFIX}/%'`).run();
}
