import { readFileSync } from "node:fs";

export const SUITE_PACKAGE_NAMES = [
  "@minhduydev/pi-core",
  "@minhduydev/pi-subagents",
  "@minhduydev/pi-learning",
  "@minhduydev/pi-todo",
];

export const SUITE_PUBLISH_ORDER = [
  "@minhduydev/pi-core",
  "@minhduydev/pi-subagents",
  "@minhduydev/pi-learning",
  "@minhduydev/pi-todo",
  "@minhduydev/pi-harness",
];

const EXACT_NPM_SPEC = /^npm:(@minhduydev\/pi-(?:core|subagents|learning|todo))@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export function parseSuitePins(settings) {
  if (!settings || typeof settings !== "object" || !Array.isArray(settings.packages)) {
    throw new Error("settings.packages must be an array of exact npm suite pins");
  }
  const pins = new Map();
  for (const source of settings.packages) {
    if (typeof source !== "string") continue;
    const match = source.match(EXACT_NPM_SPEC);
    if (!match) continue;
    const name = match[1];
    if (pins.has(name)) throw new Error(`duplicate suite pin: ${name}`);
    pins.set(name, { source, spec: source.slice("npm:".length), version: match[2] });
  }
  const missing = SUITE_PACKAGE_NAMES.filter((name) => !pins.has(name));
  if (missing.length > 0) throw new Error(`missing exact suite pins: ${missing.join(", ")}`);
  return Object.fromEntries(SUITE_PACKAGE_NAMES.map((name) => [name, pins.get(name)]));
}

export function readSuitePins(settingsPath) {
  return parseSuitePins(JSON.parse(readFileSync(settingsPath, "utf8")));
}
