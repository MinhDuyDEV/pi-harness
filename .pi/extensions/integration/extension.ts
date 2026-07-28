/**
 * Integration doctor — the harness's answer for "is the pi-* suite wired up?"
 *
 * The audit's central architectural finding (§2.1): the harness called itself
 * the integration hub while declaring no relationship to the packages it
 * integrates, and every missing or mismatched piece degraded to silence. The
 * compatibility matrix below is the one artifact that justifies a hub — it
 * says which versions of the suite go together — and `/integration` turns a
 * silent misconfiguration into a report.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  PI_CORE_PROTOCOL_VERSION,
  assertPiCoreProtocolVersion,
} from "@minhduydev/pi-core";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readExtensionGate } from "../lib/harness-settings.js";

/**
 * Which sibling versions this harness release is verified against.
 *
 * Ranges, not pins: the pins in `.pi/settings.json` say what a consumer
 * INSTALLS; this matrix says what the harness can WORK WITH, and the doctor
 * reports any installed version outside it. Update it in the same commit as a
 * contract change — the release gate e2e runs against the pins, so a matrix
 * that drifts from reality fails loudly there.
 */
export const COMPATIBILITY = {
  "@minhduydev/pi-core": { range: ">=0.2.0 <0.3.0", protocol: PI_CORE_PROTOCOL_VERSION },
  "@minhduydev/pi-subagents": { range: ">=0.10.0 <0.11.0" },
  "@minhduydev/pi-learning": { range: ">=0.4.0 <0.5.0" },
  "@minhduydev/pi-todo": { range: ">=0.4.0 <0.5.0" },
} as const;

type PackageName = keyof typeof COMPATIBILITY;

interface PackageStatus {
  name: PackageName;
  wanted: string;
  installed?: string;
  ok: boolean;
  detail: string;
}

/**
 * Minimal semver-range check for the two shapes the matrix uses
 * (">=A.B.C <X.Y.Z"). Not a general semver engine on purpose: a dependency
 * for this would be heavier than the check.
 */
function versionSatisfies(version: string, range: string): boolean {
  const parse = (value: string): number[] | undefined => {
    const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
  };
  const compare = (a: number[], b: number[]): number => {
    for (let index = 0; index < 3; index += 1) {
      if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
    }
    return 0;
  };
  const actual = parse(version);
  if (!actual) return false;
  for (const clause of range.split(/\s+/)) {
    const match = clause.match(/^(>=|<=|<|>|=)?(.+)$/);
    if (!match) return false;
    const bound = parse(match[2] ?? "");
    if (!bound) return false;
    const relation = compare(actual, bound);
    switch (match[1] ?? "=") {
      case ">=": if (relation < 0) return false; break;
      case "<=": if (relation > 0) return false; break;
      case ">": if (relation <= 0) return false; break;
      case "<": if (relation >= 0) return false; break;
      default: if (relation !== 0) return false;
    }
  }
  return true;
}

function installedVersion(name: string, cwd: string): string | undefined {
  // Resolve the way the runtime does — through the module graph — falling
  // back to Pi's package-manager tree for installed-as-package consumers.
  try {
    const require = createRequire(import.meta.url);
    const manifest = require(`${name}/package.json`) as { version?: string };
    if (typeof manifest.version === "string") return manifest.version;
  } catch {
    // Try the Pi install tree below.
  }
  for (const root of [
    join(cwd, ".pi", "npm", "node_modules"),
    join(cwd, "node_modules"),
  ]) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(root, name, "package.json"), "utf8"),
      ) as { version?: string };
      if (typeof manifest.version === "string") return manifest.version;
    } catch {
      // Not here.
    }
  }
  return undefined;
}

export function integrationReport(cwd: string): PackageStatus[] {
  const statuses: PackageStatus[] = [];
  for (const [name, wanted] of Object.entries(COMPATIBILITY) as Array<
    [PackageName, (typeof COMPATIBILITY)[PackageName]]
  >) {
    const installed = installedVersion(name, cwd);
    if (installed === undefined) {
      statuses.push({
        name,
        wanted: wanted.range,
        ok: false,
        detail: "not installed — the integration it provides is inactive",
      });
      continue;
    }
    const ok = versionSatisfies(installed, wanted.range);
    statuses.push({
      name,
      wanted: wanted.range,
      installed,
      ok,
      detail: ok
        ? "compatible"
        : `installed ${installed} is outside the verified range ${wanted.range}`,
    });
  }
  return statuses;
}

export default function integrationExtension(pi: ExtensionAPI): void {
  if (!readExtensionGate(undefined, "integration", false)) return;
  assertPiCoreProtocolVersion(1);

  pi.registerCommand("integration", {
    description: "Report pi-* suite integration health: installed versions vs the compatibility matrix",
    async handler(_args: string, ctx: ExtensionCommandContext): Promise<void> {
      const statuses = integrationReport(process.cwd());
      const lines = [
        "## pi-* integration",
        "",
        `pi-core protocol: ${PI_CORE_PROTOCOL_VERSION}`,
        "",
        ...statuses.map((status) => {
          const mark = status.ok ? "✓" : "✗";
          const version = status.installed ? `@${status.installed}` : "";
          return `${mark} ${status.name}${version} — ${status.detail} (verified: ${status.wanted})`;
        }),
      ];
      const broken = statuses.filter((status) => !status.ok);
      if (broken.length > 0) {
        lines.push(
          "",
          "Install or align the packages above; the suite degrades to silent no-ops without them.",
        );
      }
      ctx.ui?.notify?.(lines.join("\n"), broken.length > 0 ? "warning" : "info");
    },
  });

  // Report installed sibling versions outside the verified compatibility matrix.
  pi.on("session_start", (_event, context) => {
    const broken = integrationReport(context.cwd).filter((status) => !status.ok);
    const missingOnly = broken.every((status) => status.installed === undefined);
    if (broken.length === 0 || missingOnly) return; // absent siblings are a supported setup
    context.ui.notify(
      `pi-* version drift: ${broken
        .filter((status) => status.installed !== undefined)
        .map((status) => `${status.name}@${status.installed} (verified: ${status.wanted})`)
        .join(", ")} — run /integration for the full report`,
      "warning",
    );
  });
}
