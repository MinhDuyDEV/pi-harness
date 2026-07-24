#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const errors = [];
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

for (const section of ["extensions", "skills", "prompts", "themes"]) {
  for (const entry of packageJson.pi?.[section] ?? []) {
    const path = entry.startsWith("./") ? entry.slice(2) : entry;
    if (!existsSync(path)) errors.push(`package.json pi.${section} path does not exist: ${entry}`);
  }
}

for (const path of packageJson.files ?? []) {
  if (path.startsWith("!")) continue; // npm files-field negation (exclusion pattern), not a path to verify
  if (!existsSync(path)) errors.push(`package.json files entry does not exist: ${path}`);
}

if (packageJson.bin) errors.push("package.json must not expose the removed pi-harness CLI");
if (packageJson.scripts?.postinstall) errors.push("package.json must not run a nested postinstall install");
if (existsSync(".pi/extensions/package.json")) errors.push("extension dependencies must live at the package root");
if (existsSync(".pi/extensions/herdr-agent-state.ts")) errors.push("machine-managed HerdR state must not be tracked as a project extension");
for (const [dependency, version] of Object.entries({
  "@earendil-works/pi-ai": "*",
  "@earendil-works/pi-coding-agent": "*",
  "@earendil-works/pi-tui": "*",
  typebox: "1.1.38",
})) {
  if (packageJson.peerDependencies?.[dependency] !== version) errors.push(`${dependency} peer version must be ${version}`);
}
for (const dependency of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
  if (packageJson.devDependencies?.[dependency] !== "0.81.1") errors.push(`${dependency} development version must be 0.81.1`);
}
if (packageJson.devDependencies?.typebox !== "1.1.38") errors.push("typebox development version must match the Pi 0.81.1 host");
if (packageJson.engines?.node !== ">=22.19.0") errors.push("package.json must declare Node >=22.19.0");
if (packageJson.packageManager !== "npm@11.12.1") errors.push("package.json must declare npm@11.12.1 as the package manager");

const settings = JSON.parse(readFileSync(".pi/settings.json", "utf8"));
for (const key of ["extensions", "skills", "prompts", "themes"]) {
  if (key in settings) errors.push(`.pi/settings.json should rely on convention discovery instead of project ${key} paths`);
}
if (settings.defaultModel || settings.defaultProvider) errors.push(".pi/settings.json must not pin a personal model/provider");
if (settings.defaultProjectTrust) errors.push(".pi/settings.json must not claim to configure project trust");
if (settings.terminal?.autoResize !== undefined) errors.push("terminal.autoResize is not a Pi setting; use images.autoResize");

for (const source of settings.packages ?? []) {
  if (/latest|\*|\^|~/.test(source)) errors.push(`package source is not pinned: ${source}`);
  if (source.startsWith("npm:") && !/@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(source)) errors.push(`npm package must use an exact version: ${source}`);
  if (source.startsWith("git:") && !/#[0-9a-f]{40}$/i.test(source)) errors.push(`git package must use an immutable 40-character commit: ${source}`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `✗ ${error}`).join("\n"));
  process.exit(1);
}

console.log("✓ package and Pi settings contract is valid");
