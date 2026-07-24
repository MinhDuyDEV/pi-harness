#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

for (const directory of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const path = join(root, directory.name, "SKILL.md");
  try {
    statSync(path);
  } catch {
    errors.push(`${path}: missing SKILL.md`);
    continue;
  }
  const parsed = parseFrontmatter(path);
  const name = parsed.values.get("name")?.replace(/^['"]|['"]$/g, "");
  const description = parsed.values.get("description") ?? "";
  if (!name) errors.push(`${path}: missing name`);
  if (!description.trim()) errors.push(`${path}: missing description`);
  if (name && name !== directory.name) errors.push(`${path}: name ${name} does not match directory ${directory.name}`);
  if (parsed.body.trim().split(/\s+/).filter(Boolean).length > 700) errors.push(`${path}: body exceeds 700 words; compress or split the skill`);
  skills.push({ name: directory.name, path, hash: createHash("sha256").update(readFileSync(path)).digest("hex") });
}

const names = new Set();
for (const skill of skills) {
  if (names.has(skill.name)) errors.push(`duplicate skill name: ${skill.name}`);
  names.add(skill.name);
}

if (process.argv.includes("--update")) {
  let existing = {};
  let version = 1;
  try {
    const prev = JSON.parse(readFileSync("skills-lock.json", "utf8"));
    existing = prev.skills ?? {};
    version = prev.version ?? version;
  } catch {}
  const next = {};
  for (const skill of skills) {
    const prev = existing[skill.name] ?? {};
    next[skill.name] = {
      source: prev.source ?? "local",
      sourceType: prev.sourceType ?? "local",
      skillPath: skill.path,
      trust: prev.trust ?? "local",
      computedHash: skill.hash,
    };
  }
  writeFileSync("skills-lock.json", JSON.stringify({ version, skills: next }, null, 2) + "\n");
  console.log(`✓ regenerated skills-lock.json (${skills.length} skills)`);
  if (errors.length > 0) {
    console.error(errors.map((error) => `✗ ${error}`).join("\n"));
    process.exit(1);
  }
  process.exit(0);
}

try {
  const lock = JSON.parse(readFileSync("skills-lock.json", "utf8"));
  const locked = lock.skills ?? {};
  if (Object.keys(locked).length !== skills.length) {
    errors.push(`skills-lock.json contains ${Object.keys(locked).length} entries; expected ${skills.length}`);
  }
  for (const skill of skills) {
    const entry = locked[skill.name];
    if (!entry) errors.push(`skills-lock.json missing ${skill.name}`);
    else if (entry.computedHash !== skill.hash) errors.push(`skills-lock.json hash mismatch for ${skill.name}`);
  }
} catch (error) {
  errors.push(`skills-lock.json: ${error.message}`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `✗ ${error}`).join("\n"));
  process.exit(1);
}

console.log(`✓ validated ${skills.length} skills and matching hashes`);
