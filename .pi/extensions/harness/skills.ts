import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sprint } from "./parsing.js";

export interface SkillRegistryEntry {
	name: string;
	path: string;
	description: string;
	version?: string;
	dependencies?: string[];
	role_usage?: Record<string, "avoid" | "recommend" | "conditional" | "load">;
	trigger_strength?: "mandatory" | "recommended" | "conditional";
	triggers?: string[];
}

export interface SkillRegistry {
	skills: SkillRegistryEntry[];
}

export interface SkillHints {
	names: string[];
	workerText: string;
	reviewerText: string;
	warnings: string[];
}

function loadSkillRegistry(projectRoot: string): SkillRegistryEntry[] {
	const registryPath = join(projectRoot, ".pi", "skills", "registry.json");
	if (!existsSync(registryPath)) return [];
	try {
		const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as SkillRegistry;
		return Array.isArray(parsed.skills) ? parsed.skills : [];
	} catch {
		return [];
	}
}

function unique(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function expandDependencies(entriesByName: Map<string, SkillRegistryEntry>, names: string[]): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	const visit = (name: string) => {
		if (seen.has(name)) return;
		seen.add(name);
		const entry = entriesByName.get(name);
		if (!entry) return;
		for (const dependency of entry.dependencies ?? []) visit(dependency);
		result.push(name);
	};
	for (const name of names) visit(name);
	return result;
}

function formatSkillList(title: string, entries: SkillRegistryEntry[]): string {
	if (entries.length === 0) return "";
	return [
		title,
		...entries.map((entry) => {
			const usage = entry.role_usage ? Object.entries(entry.role_usage).map(([role, value]) => `${role}:${value}`).join(", ") : "";
			const suffix = usage ? ` (${usage})` : "";
			return `- ${entry.name}${suffix} — ${entry.description}`;
		}),
	].join("\n");
}

export function resolveSkillHints(projectRoot: string, sprint: Sprint): SkillHints {
	const registry = loadSkillRegistry(projectRoot);
	const entriesByName = new Map(registry.map((entry) => [entry.name, entry]));
	const requested = unique(sprint.skills ?? []);
	const warnings: string[] = [];
	const valid: string[] = [];

	for (const name of requested) {
		const entry = entriesByName.get(name);
		if (!entry) {
			warnings.push(`Sprint ${sprint.number} requested unknown skill "${name}"; ignoring it.`);
			continue;
		}
		const skillPath = join(projectRoot, ".pi", entry.path);
		if (!existsSync(skillPath)) {
			warnings.push(`Sprint ${sprint.number} requested skill "${name}" but ${entry.path} does not exist; ignoring it.`);
			continue;
		}
		valid.push(name);
	}

	const names = expandDependencies(entriesByName, valid);
	const entries = names.map((name) => entriesByName.get(name)).filter((entry): entry is SkillRegistryEntry => Boolean(entry));
	const workerEntries = entries.filter((entry) => entry.role_usage?.worker !== "avoid");
	const reviewerEntries = entries.filter((entry) => entry.role_usage?.reviewer !== "avoid");

	return {
		names,
		workerText: formatSkillList("Recommended Skills:", workerEntries),
		reviewerText: formatSkillList("Relevant Review Skills:", reviewerEntries),
		warnings,
	};
}
