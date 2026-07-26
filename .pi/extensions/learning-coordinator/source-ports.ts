/**
 * Discovery of producer replay ports.
 *
 * Two audit findings die here (§2.1). First, the producer list was a
 * hardcoded allowlist of two import specifiers — a third producer had no way
 * to join without editing the harness, which is the opposite of an
 * integration hub. Producers now advertise themselves: a package that sets
 * `pi.replayPort` in its manifest (e.g. `"pi": { "replayPort": "./replay" }`)
 * is discovered by scanning the installed manifests, and an operator can pin
 * or extend the list via `pi-harness.producers` in `.pi/settings.json`.
 *
 * Second, every load failure was swallowed by a bare `catch {}` — a consumer
 * who installed the harness without the siblings got `ports = []`, no replay,
 * and not one line of warning. Loading now returns a REPORT that
 * distinguishes "not installed" (fine, the integration is optional) from "the
 * module exists but failed to load" (a real error someone needs to see), and
 * the coordinator surfaces the latter.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDcpReplayPort } from "../dcp/replay.js";
import type { ReplayPort } from "./public-replay.js";

export type ProducerName = "pi-subagents" | "pi-todo" | "dcp";

export interface ProducerPortStatus {
  producer: string;
  specifier: string;
  status: "loaded" | "not-installed" | "error";
  detail?: string;
}

export interface ProducerPorts {
  ports: Array<{ producer: ProducerName; port: ReplayPort<unknown> }>;
  report: ProducerPortStatus[];
}

interface ProducerSpec {
  /** Short producer name used in cursors ("pi-subagents", "pi-todo", …). */
  producer: string;
  /** Import specifier of the replay module. */
  specifier: string;
}

interface ReplayModule {
  [factory: string]: unknown;
}

const FACTORY_NAMES = [
  "createOrchestrationReplayPort",
  "createTodoReplayPort",
  "createReplayPort",
] as const;

/** Producer short-name from a package name: "@scope/pi-todo" → "pi-todo". */
function producerNameFor(packageName: string): string {
  return packageName.split("/").at(-1) ?? packageName;
}

/**
 * Producers declared by the operator in `.pi/settings.json`:
 * `{ "pi-harness": { "producers": [{ "package": "@scope/pkg", "specifier": "@scope/pkg/replay" }] } }`.
 */
function settingsProducers(projectDirectory: string): ProducerSpec[] | undefined {
  try {
    const settings = JSON.parse(
      readFileSync(join(projectDirectory, ".pi", "settings.json"), "utf8"),
    ) as { "pi-harness"?: { producers?: unknown } };
    const declared = settings["pi-harness"]?.producers;
    if (!Array.isArray(declared)) return undefined;
    const specs: ProducerSpec[] = [];
    for (const entry of declared) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.package !== "string") continue;
      const specifier =
        typeof record.specifier === "string"
          ? record.specifier
          : record.package;
      specs.push({ producer: producerNameFor(record.package), specifier });
    }
    return specs;
  } catch {
    return undefined;
  }
}

/**
 * Scan installed package manifests for the `pi.replayPort` field. Roots
 * cover Pi's package-manager install tree and a source checkout's own
 * node_modules (the dev loop).
 */
function manifestProducers(projectDirectory: string): ProducerSpec[] {
  const roots = [
    join(projectDirectory, ".pi", "npm", "node_modules"),
    join(projectDirectory, "node_modules"),
  ];
  const specs = new Map<string, ProducerSpec>();
  for (const root of roots) {
    for (const packageName of listPackages(root)) {
      const manifestPath = join(root, packageName, "package.json");
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
          name?: string;
          pi?: { replayPort?: unknown };
        };
        const replayPort = manifest.pi?.replayPort;
        if (typeof replayPort !== "string") continue;
        const name = manifest.name ?? packageName;
        // "./replay" relative to the package → "pkg/replay" as a specifier.
        const subpath = replayPort.replace(/^\.\//, "");
        specs.set(name, {
          producer: producerNameFor(name),
          specifier: `${name}/${subpath}`,
        });
      } catch {
        // Unreadable manifest: not a producer.
      }
    }
  }
  return [...specs.values()];
}

function listPackages(root: string): string[] {
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".")) continue;
      if (entry.name.startsWith("@")) {
        try {
          for (const scoped of readdirSync(join(root, entry.name), { withFileTypes: true })) {
            if (scoped.isDirectory() || scoped.isSymbolicLink()) {
              names.push(`${entry.name}/${scoped.name}`);
            }
          }
        } catch {
          // Skip unreadable scope dir.
        }
      } else {
        names.push(entry.name);
      }
    }
    return names;
  } catch {
    return [];
  }
}

function isModuleNotFound(error: unknown, specifier: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") return false;
  // Only the TARGET being absent counts as "not installed"; a missing
  // transitive import inside an installed producer is a real error.
  const packageName = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0] ?? specifier;
  return error.message.includes(packageName);
}

async function loadPort(
  spec: ProducerSpec,
  projectDirectory: string,
): Promise<{ port?: ReplayPort<unknown>; status: ProducerPortStatus }> {
  try {
    const module = (await import(spec.specifier)) as ReplayModule;
    for (const name of FACTORY_NAMES) {
      const factory = module[name];
      if (typeof factory === "function") {
        return {
          port: (factory as (input: { projectDirectory: string }) => ReplayPort<unknown>)({
            projectDirectory,
          }),
          status: { producer: spec.producer, specifier: spec.specifier, status: "loaded" },
        };
      }
    }
    return {
      status: {
        producer: spec.producer,
        specifier: spec.specifier,
        status: "error",
        detail: `module loaded but exports none of: ${FACTORY_NAMES.join(", ")}`,
      },
    };
  } catch (error) {
    if (isModuleNotFound(error, spec.specifier)) {
      return {
        status: { producer: spec.producer, specifier: spec.specifier, status: "not-installed" },
      };
    }
    return {
      status: {
        producer: spec.producer,
        specifier: spec.specifier,
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function loadProducerReplayPorts(
  projectDirectory: string,
): Promise<ProducerPorts> {
  // Settings take precedence; the manifest scan is the default; the two known
  // producers remain as a floor so a bare checkout without installed siblings
  // still reports them as not-installed instead of pretending they don't exist.
  const declared =
    settingsProducers(projectDirectory) ?? manifestProducers(projectDirectory);
  const specs = new Map<string, ProducerSpec>();
  for (const spec of [
    { producer: "pi-subagents", specifier: "@minhduydev/pi-subagents/replay" },
    { producer: "pi-todo", specifier: "@minhduydev/pi-todo/replay" },
    ...declared,
  ]) {
    specs.set(spec.producer, spec);
  }

  const results = await Promise.all(
    [...specs.values()].map((spec) => loadPort(spec, projectDirectory)),
  );

  const ports: ProducerPorts["ports"] = [];
  const report: ProducerPortStatus[] = [];
  for (const result of results) {
    report.push(result.status);
    if (result.port) {
      ports.push({
        producer: result.status.producer as ProducerName,
        port: result.port,
      });
    }
  }

  const dcp = createDcpReplayPort({ projectDirectory });
  if (dcp) {
    ports.push({ producer: "dcp", port: dcp });
    report.push({ producer: "dcp", specifier: "(built-in)", status: "loaded" });
  }

  return { ports, report };
}
