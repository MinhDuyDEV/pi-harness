#!/usr/bin/env node

/** Generate the superpi route table from its checked-in route metadata. */
import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
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
  const routed = new Set();
  const rows = metadata.routes.map((route) => {
    if (!route || !["stage", "domain"].includes(route.axis) || typeof route.task !== "string" || !Array.isArray(route.skills)) {
      fail("route shape is invalid; axis must be stage or domain");
    }
    if (seenTasks.has(route.task)) fail(`duplicate task ${route.task}`);
    seenTasks.add(route.task);
    if (route.skills.length === 0 || route.skills.length > metadata.maxSkillsPerRoute) {
      fail(`${route.task} has ${route.skills.length} skills; maximum is ${metadata.maxSkillsPerRoute}`);
    }
    for (const name of route.skills) {
      if (typeof name !== "string") fail(`${route.task} contains a non-string skill`);
      if (isHidden(readSkill(name))) fail(`${route.task} routes to hidden skill ${name}; make it visible or remove it`);
      routed.add(name);
    }
    return `| ${route.axis} | ${route.task} | ${route.skills.map((name) => `\`${name}\``).join(" → ")} |`;
  });
  const exemptions = new Set(metadata.exemptions ?? []);
  const visible = new Set();
  for (const name of readdirSync(skillRoot)) {
    const path = resolve(skillRoot, name, "SKILL.md");
    if (existsSync(path) && !isHidden(readFileSync(path, "utf8"))) visible.add(name);
  }
  for (const name of visible) if (!routed.has(name) && !exemptions.has(name)) fail(`visible skill ${name} is neither routed nor explicitly exempted`);
  for (const name of exemptions) if (!visible.has(name)) fail(`exemption references missing or hidden skill ${name}`);
  return [
    start,
    "## Routing table",
    "",
    "Select one stage route, then add at most one matching domain overlay. Every model-visible skill is routed below or listed in `exemptions` in `route-metadata.json`.",
    "",
    "| Axis | Task type | Skill chain (load order) |",
    "| --- | --- | --- |",
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
