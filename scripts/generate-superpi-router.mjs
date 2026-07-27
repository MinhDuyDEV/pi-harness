#!/usr/bin/env node

/** Generate the superpi route table from its checked-in route metadata. */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const skillRoot = resolve(".pi/skills");
const metadataPath = resolve(skillRoot, "superpi/route-metadata.json");
const skillPath = resolve(skillRoot, "superpi/SKILL.md");
const start = "<!-- GENERATED ROUTES:START -->";
const end = "<!-- GENERATED ROUTES:END -->";

function fail(message) {
  throw new Error(`superpi routes: ${message}`);
}

function readSkill(name) {
  const path = resolve(skillRoot, name, "SKILL.md");
  if (!existsSync(path)) fail(`route references missing skill ${name}`);
  return readFileSync(path, "utf8");
}

function isHidden(skill) {
  return /^disable-model-invocation:\s*true\s*$/m.test(skill);
}

function render(metadata) {
  if (!Number.isInteger(metadata.maxSkillsPerRoute) || metadata.maxSkillsPerRoute < 1) {
    fail("maxSkillsPerRoute must be a positive integer");
  }
  if (!Array.isArray(metadata.routes) || metadata.routes.length === 0) fail("routes must be a non-empty array");
  const seenTasks = new Set();
  const rows = metadata.routes.map((route) => {
    if (!route || typeof route.task !== "string" || !Array.isArray(route.skills)) fail("route shape is invalid");
    if (seenTasks.has(route.task)) fail(`duplicate task ${route.task}`);
    seenTasks.add(route.task);
    if (route.skills.length === 0 || route.skills.length > metadata.maxSkillsPerRoute) {
      fail(`${route.task} has ${route.skills.length} skills; maximum is ${metadata.maxSkillsPerRoute}`);
    }
    for (const name of route.skills) {
      if (typeof name !== "string") fail(`${route.task} contains a non-string skill`);
      if (isHidden(readSkill(name))) fail(`${route.task} routes to hidden skill ${name}; make it visible or remove it`);
    }
    return `| ${route.task} | ${route.skills.map((name) => `\`${name}\``).join(" → ")} |`;
  });
  return [
    start,
    "## Routing table",
    "",
    "Match the task to a row, then load the listed skills in order. A parenthesized condition in a skill is optional; the route itself is never more than three skills.",
    "",
    "| Task type | Skill chain (load order) |",
    "| --- | --- |",
    ...rows,
    "",
    end,
  ].join("\n");
}

const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
const current = readFileSync(skillPath, "utf8");
const generated = render(metadata);
const expression = new RegExp(`${start}[\\s\\S]*?${end}`);
if (!expression.test(current)) fail("SKILL.md is missing generated-route markers");
const next = current.replace(expression, generated);

if (process.argv.includes("--check")) {
  if (next !== current) fail("SKILL.md is stale; run node scripts/generate-superpi-router.mjs");
  console.log("✓ superpi routes match route-metadata.json");
} else {
  writeFileSync(skillPath, next);
  console.log("✓ generated superpi route table");
}
