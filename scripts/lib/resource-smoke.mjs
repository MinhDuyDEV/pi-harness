/** Shared source and packed-resource loading assertions. */
import { resolve, relative, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { MAX_VISIBLE_SKILLS, MAX_DESCRIPTION_CHARS } from "./skill-budget.mjs";

function formatDiagnostic(diagnostic) {
  if (typeof diagnostic === "string") return diagnostic;
  const location = diagnostic.path ? `${diagnostic.path}: ` : "";
  return `${location}${diagnostic.message ?? JSON.stringify(diagnostic)}`;
}

export function assertResourcesLoad(loader, { root }) {
  const counts = assertPackageResourcesLoad(loader, { packageRoot: root });
  const extensions = loader.getExtensions().extensions;
  const skills = loader.getSkills().skills;
  const extensionPaths = extensions.map((extension) => extension.path);
  const modelVisibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
  const visibleDescriptionCharacters = modelVisibleSkills.reduce(
    (total, skill) => total + skill.description.length,
    0,
  );

  if (modelVisibleSkills.length > MAX_VISIBLE_SKILLS || visibleDescriptionCharacters > MAX_DESCRIPTION_CHARS) {
    throw new Error(
      `skill prompt budget exceeded: ${modelVisibleSkills.length} skills / ${visibleDescriptionCharacters} characters`,
    );
  }
  if (new Set(extensionPaths).size !== extensionPaths.length) {
    throw new Error("duplicate extension paths discovered");
  }
  if (!loader.getAgentsFiles().agentsFiles.some((entry) => entry.path.endsWith("/AGENTS.md"))) {
    throw new Error("root AGENTS.md was not loaded");
  }

  const appendPath = join(root, ".pi/APPEND_SYSTEM.md");
  if (!existsSync(appendPath)) {
    throw new Error(".pi/APPEND_SYSTEM.md is missing from the project root");
  }
  const heading = readFileSync(appendPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("#"));
  if (!heading || !loader.getAppendSystemPrompt().some((content) => content.includes(heading))) {
    throw new Error(".pi/APPEND_SYSTEM.md was not loaded by the resource loader");
  }

  return `loaded ${counts.extensions} extensions, ${counts.skills} skills (${modelVisibleSkills.length} model-visible), ${counts.prompts} prompts, and ${counts.themes} themes`;
}

/**
 * Assert every path in `paths` is inside `root` (resolved), proving the loader
 * read packaged content rather than reaching back into the source repository.
 */
export function assertPathsWithinRoot(paths, root) {
  const absRoot = resolve(root);
  const escaped = [];
  for (const p of paths) {
    if (p === undefined || p === null) continue;
    const rel = relative(absRoot, resolve(p));
    if (rel.startsWith("..") || resolve(p) === absRoot) escaped.push(p);
  }
  if (escaped.length > 0) {
    throw new Error(
      `resources resolved outside the package root ${absRoot}:\n${escaped.join("\n")}`,
    );
  }
}
/**
 * Validate resources as an installed Pi package from an otherwise empty
 * consumer directory. Only manifest resource types are expected here; project
 * context files and pi-task agent definitions are not Pi package resources.
 *
 * @param {import("@earendil-works/pi-coding-agent").DefaultResourceLoader} loader
 * @param {{ packageRoot: string }} options
 * @returns {{ extensions: number, skills: number, prompts: number, themes: number }}
 */
export function assertPackageResourcesLoad(loader, { packageRoot }) {
  const extensionResult = loader.getExtensions();
  const skillResult = loader.getSkills();
  const promptResult = loader.getPrompts();
  const themeResult = loader.getThemes();
  const diagnostics = [
    ...(extensionResult.errors ?? []),
    ...(skillResult.diagnostics ?? []),
    ...(promptResult.diagnostics ?? []),
    ...(themeResult.diagnostics ?? []),
  ];
  if (diagnostics.length > 0) {
    throw new Error(`Resource loader diagnostics:\n${diagnostics.map(formatDiagnostic).join("\n")}`);
  }

  const groups = {
    extensions: extensionResult.extensions,
    skills: skillResult.skills,
    prompts: promptResult.prompts,
    themes: themeResult.themes,
  };
  for (const [label, resources] of Object.entries(groups)) {
    if (resources.length === 0) throw new Error(`No ${label} loaded from package manifest`);
  }

  assertPathsWithinRoot(
    [
      ...groups.extensions.map((item) => item.path),
      ...groups.skills.map((item) => item.filePath),
      ...groups.prompts.map((item) => item.path),
      ...groups.themes.map((item) => item.path),
    ],
    packageRoot,
  );

  return Object.fromEntries(
    Object.entries(groups).map(([label, resources]) => [label, resources.length]),
  );
}
