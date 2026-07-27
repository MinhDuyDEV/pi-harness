#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSuitePins, SUITE_PACKAGE_NAMES, SUITE_PUBLISH_ORDER } from "./lib/suite-pins.mjs";

export function checkRegistryPins(pins, run = spawnSync) {
  const results = [];
  for (const name of SUITE_PACKAGE_NAMES) {
    const pin = pins[name];
    const result = run("npm", ["view", pin.spec, "version", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let returnedVersions = [];
    if (result.status === 0) {
      try {
        const decoded = JSON.parse(String(result.stdout ?? ""));
        returnedVersions = Array.isArray(decoded)
          ? decoded.filter((value) => typeof value === "string")
          : typeof decoded === "string"
            ? [decoded]
            : [];
      } catch {
        returnedVersions = [];
      }
    }
    const stderr = String(result.stderr ?? "").trim();
    const missing =
      result.status !== 0 &&
      /(?:\bE404\b|404 Not Found|is not in this registry)/iu.test(stderr);
    const available = result.status === 0 && returnedVersions.includes(pin.version);
    const status = available
      ? "available"
      : result.status === 0
        ? "mismatch"
        : missing
          ? "missing"
          : "error";
    results.push({
      name,
      version: pin.version,
      spec: pin.spec,
      available,
      status,
      detail: available
        ? pin.version
        : status === "mismatch"
          ? `registry returned ${returnedVersions.length > 0 ? returnedVersions.join(", ") : "no parseable version"}`
          : String(
              result.stderr ||
                result.stdout ||
                result.error?.message ||
                "registry lookup failed",
            )
              .trim()
              .split("\n")
              .at(-1),
    });
  }
  return results;
}

export function renderRegistryReport(results) {
  const lines = results.map((result) =>
    `${result.available ? "✓" : "✗"} ${result.spec}${result.available ? "" : ` — ${result.detail || "not available"}`}`,
  );
  const missing = results.filter((result) => result.status === "missing");
  const lookupFailures = results.filter(
    (result) => result.status === "error" || result.status === "mismatch",
  );
  if (missing.length > 0) {
    lines.push(
      "",
      "Registry preflight found exact suite versions that are not published.",
      `Publish order: ${SUITE_PUBLISH_ORDER.join(" → ")}`,
      `Missing now: ${missing.map((result) => result.spec).join(", ")}`,
    );
  }
  if (lookupFailures.length > 0) {
    lines.push(
      "",
      "Registry preflight also encountered lookup errors/version mismatches; these are not classified as unpublished packages.",
      `Investigate: ${lookupFailures.map((result) => result.spec).join(", ")}`,
    );
  }
  return lines.join("\n");
}

function main() {
  const settingsPath = resolve(process.cwd(), ".pi", "settings.json");
  const pins = readSuitePins(settingsPath);
  const results = checkRegistryPins(pins);
  process.stderr.write(`${renderRegistryReport(results)}\n`);
  if (results.some((result) => !result.available)) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
