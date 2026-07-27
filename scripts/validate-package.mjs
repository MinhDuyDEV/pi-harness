#!/usr/bin/env node

import { existsSync, globSync, readFileSync } from "node:fs";

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

if (packageJson.bin) {
  const entries = Object.entries(packageJson.bin);
  if (entries.length !== 1 || entries[0]?.[0] !== "pi-harness-init" || entries[0]?.[1] !== "./scripts/init-consumer.mjs") {
    errors.push("package.json may expose only the portable pi-harness-init consumer bootstrap");
  }
}
if (packageJson.scripts?.postinstall) errors.push("package.json must not run a nested postinstall install");
// Recursive, not just the top of .pi/extensions: a nested package.json with
// its own `pi.extensions` (e.g. rewind/) ships inside the payload and can
// double-register when installed as a package (audit roadmap 34). Every
// manifest below .pi/ must be deliberate; today none are allowed.
// Scan only the .pi trees that SHIP (per the files list above), recursively —
// the old check looked at exactly one path. A nested manifest declaring its
// own `pi` config (e.g. rewind/ used to) ships in the payload — npm
// force-includes nested package.json, a files negation cannot exclude it —
// and can double-register its extensions when installed as a package (audit
// roadmap 34). Manifests without a `pi` field (skill dependency manifests)
// are fine.
for (const shipped of (packageJson.files ?? []).filter((entry) => entry.startsWith(".pi/"))) {
  if (!existsSync(shipped)) continue;
  for (const nested of globSync(`${shipped}/**/package.json`)) {
    if (nested.includes("node_modules")) continue;
    try {
      const manifest = JSON.parse(readFileSync(nested, "utf8"));
      if (manifest.pi !== undefined) {
        errors.push(
          `nested manifest declares pi config and ships in the payload (double-register risk): ${nested}`,
        );
      }
    } catch {
      errors.push(`nested manifest is unreadable: ${nested}`);
    }
  }
}
if (existsSync(".pi/extensions/herdr-agent-state.ts")) errors.push("machine-managed HerdR state must not be tracked as a project extension");
// One bounded range across the whole pi-* suite (audit X-C): "*" protected
// nothing, and pi-learning's caret range excluded 0.82 while the others
// accepted it — the peer conflict would have appeared only at install time.
for (const [dependency, version] of Object.entries({
  "@earendil-works/pi-ai": ">=0.81.1 <0.82.0",
  "@earendil-works/pi-coding-agent": ">=0.81.1 <0.82.0",
  "@earendil-works/pi-tui": ">=0.81.1 <0.82.0",
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
