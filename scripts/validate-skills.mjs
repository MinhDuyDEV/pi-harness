#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HARD_WORD_CAP, MAX_DESCRIPTION_CHARS, MAX_VISIBLE_SKILLS } from "./lib/skill-budget.mjs";

const root = ".pi/skills";
const errors = [];
const skills = [];

function parseFrontmatter(path) {
  const text = readFileSync(path, "utf8");
  if (!text.startsWith("---\n")) {
    errors.push(`${path}: missing opening frontmatter delimiter`);
    return { text, body: "", values: new Map() };
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    errors.push(`${path}: missing closing frontmatter delimiter`);
    return { text, body: "", values: new Map() };
  }
  const header = text.slice(4, end);
  const values = new Map();
  for (const line of header.split("\n")) {
    const match = /^(name|description|disable-model-invocation|metadata):\s*(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
    else if (/^[A-Za-z][A-Za-z0-9-]*:\s*/.test(line)) {
      errors.push(`${path}: unsupported top-level frontmatter key: ${line.split(":", 1)[0]}`);
    }
  }
  return { text, body: text.slice(end + 4), values };
}

function descriptionFromFrontmatter(text) {
  const header = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const lines = header.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^description:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const first = match[1].trim();
    const parts = first && !/^[>|][+-]?$/.test(first) ? [first] : [];
    while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1])) {
      parts.push(lines[++index].trim());
    }
    return parts.join(" ").replace(/^['"]|['"]$/g, "");
  }
  return "";
}

/** Recursively list every file under `dir`, skipping node_modules and .DS_Store. Returns paths relative to `dir`, sorted. */
function listSkillFiles(dir, prefix = "") {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "node_modules" || entry.name === ".DS_Store") continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listSkillFiles(join(dir, entry.name), rel));
    else if (entry.isFile()) files.push(rel);
    else if (entry.isSymbolicLink()) {
      // Hash symlinks by target file content when resolvable; skip broken links.
      try {
        statSync(join(dir, entry.name));
        files.push(rel);
      } catch {
        // Broken symlink: nothing to hash.
      }
    }
  }
  return files;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

for (const directory of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const skillDir = join(root, directory.name);
  const path = join(skillDir, "SKILL.md");
  try {
    statSync(path);
  } catch {
    errors.push(`${path}: missing SKILL.md`);
    continue;
  }
  const parsed = parseFrontmatter(path);
  const name = parsed.values.get("name")?.replace(/^['"]|['"]$/g, "");
  const description = descriptionFromFrontmatter(parsed.text);
  const hidden = /^true$/i.test(parsed.values.get("disable-model-invocation") ?? "");
  if (!name) errors.push(`${path}: missing name`);
  if (!description.trim()) errors.push(`${path}: missing description`);
  if (hidden && !/\bUser-invoked\b/.test(description)) {
    errors.push(`${path}: hidden skills must use an explicit "User-invoked" description`);
  }
  if (hidden && !description.includes(`/skill:${directory.name}`)) {
    errors.push(`${path}: hidden skills must name /skill:${directory.name} in their description`);
  }
  if (!hidden && /\bUser-invoked\b/.test(description)) {
    errors.push(`${path}: model-visible skills must not describe themselves as user-invoked only`);
  }
  if (name && name !== directory.name) errors.push(`${path}: name ${name} does not match directory ${directory.name}`);
  if (parsed.body.trim().split(/\s+/).filter(Boolean).length > HARD_WORD_CAP) {
    errors.push(`${path}: body exceeds ${HARD_WORD_CAP} words; compress or split the skill`);
  }
  const files = {};
  for (const rel of listSkillFiles(skillDir)) files[rel] = sha256(join(skillDir, rel));
  skills.push({ name: directory.name, path, files });
}

const visibleSkills = skills.filter((skill) => {
  const parsed = parseFrontmatter(skill.path);
  return !/^true$/i.test(parsed.values.get("disable-model-invocation") ?? "");
});
const visibleDescriptionCharacters = visibleSkills.reduce(
  (total, skill) => total + descriptionFromFrontmatter(readFileSync(skill.path, "utf8")).length,
  0,
);
if (visibleSkills.length > MAX_VISIBLE_SKILLS) {
  errors.push(`model-visible skills ${visibleSkills.length} exceed budget ${MAX_VISIBLE_SKILLS}`);
}
if (visibleDescriptionCharacters > MAX_DESCRIPTION_CHARS) {
  errors.push(`model-visible description characters ${visibleDescriptionCharacters} exceed budget ${MAX_DESCRIPTION_CHARS}`);
}

const names = new Set();
for (const skill of skills) {
  if (names.has(skill.name)) errors.push(`duplicate skill name: ${skill.name}`);
  names.add(skill.name);
}

if (process.argv.includes("--update")) {
  let existing = {};
  let version = 2;
  try {
    const prev = JSON.parse(readFileSync("skills-lock.json", "utf8"));
    existing = prev.skills ?? {};
  } catch {
    // No previous lock (or unparseable): regenerate from scratch.
  }
  const next = {};
  for (const skill of skills) {
    const prev = existing[skill.name] ?? {};
    next[skill.name] = {
      source: prev.source ?? "local",
      sourceType: prev.sourceType ?? "local",
      skillPath: skill.path,
      trust: prev.trust ?? "local",
      files: skill.files,
    };
  }
  writeFileSync("skills-lock.json", JSON.stringify({ version, skills: next }, null, 2) + "\n");
  const fileCount = skills.reduce((total, skill) => total + Object.keys(skill.files).length, 0);
  console.log(`✓ regenerated skills-lock.json (${skills.length} skills, ${fileCount} files)`);
  if (errors.length > 0) {
    console.error(errors.map((error) => `✗ ${error}`).join("\n"));
    process.exit(1);
  }
  process.exit(0);
}

try {
  const lock = JSON.parse(readFileSync("skills-lock.json", "utf8"));
  const locked = lock.skills ?? {};
  const legacy = Object.values(locked).some((entry) => entry && typeof entry === "object" && !entry.files);
  if (legacy) {
    errors.push(
      "skills-lock.json uses the legacy per-skill computedHash format; the lock now records a per-file manifest ({ files: { relPath: sha256 } }). Run `npm run regen:skills` to migrate.",
    );
  } else {
    if (Object.keys(locked).length !== skills.length) {
      errors.push(`skills-lock.json contains ${Object.keys(locked).length} entries; expected ${skills.length}`);
    }
    for (const skill of skills) {
      const entry = locked[skill.name];
      if (!entry) {
        errors.push(`skills-lock.json missing ${skill.name}`);
        continue;
      }
      const lockedFiles = entry.files ?? {};
      for (const [rel, hash] of Object.entries(skill.files)) {
        if (!(rel in lockedFiles)) errors.push(`skills-lock.json: ${skill.name}/${rel} is on disk but not in the lock (run npm run regen:skills)`);
        else if (lockedFiles[rel] !== hash) errors.push(`skills-lock.json: hash mismatch for ${skill.name}/${rel}`);
      }
      for (const rel of Object.keys(lockedFiles)) {
        if (!(rel in skill.files)) errors.push(`skills-lock.json: ${skill.name}/${rel} is in the lock but missing on disk`);
      }
    }
    for (const name of Object.keys(locked)) {
      if (!skills.some((skill) => skill.name === name)) {
        errors.push(`skills-lock.json: ${name} is in the lock but has no skill directory`);
      }
    }
  }
} catch (error) {
  errors.push(`skills-lock.json: ${error.message}`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `✗ ${error}`).join("\n"));
  process.exit(1);
}

const fileCount = skills.reduce((total, skill) => total + Object.keys(skill.files).length, 0);
console.log(`✓ validated ${skills.length} skills (${fileCount} files) against skills-lock.json`);
