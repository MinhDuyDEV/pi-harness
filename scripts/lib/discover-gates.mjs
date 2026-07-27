import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";

const LOCKFILES = new Map([
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
]);

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function gate(command, cwd, source, kind = "aggregate") {
  return { command, cwd, source, kind };
}

async function discoverWrapper(root) {
  for (const relative of [
    "scripts/check",
    "scripts/check.sh",
    "scripts/verify",
    "scripts/verify.sh",
  ]) {
    if (await exists(join(root, relative))) {
      const command = relative.endsWith(".sh") ? `sh ${relative}` : `./${relative}`;
      return gate(command, root, relative);
    }
  }

  const makefile = await readText(join(root, "Makefile"));
  if (makefile) {
    if (/^check\s*:/mu.test(makefile)) return gate("make check", root, "Makefile");
    if (/^test\s*:/mu.test(makefile)) return gate("make test", root, "Makefile", "test");
  }

  const justfile = await readText(join(root, "justfile"));
  if (justfile) {
    if (/^check(?:\s[^:]*)?\s*:/mu.test(justfile)) return gate("just check", root, "justfile");
    if (/^test(?:\s[^:]*)?\s*:/mu.test(justfile)) return gate("just test", root, "justfile", "test");
  }

  if (await exists(join(root, "gradlew"))) {
    return gate("./gradlew check", root, "gradlew");
  }
  return undefined;
}

function packageManagerCommand(manager, script) {
  return `${manager} run ${script}`;
}

async function discoverJavaScriptGates(root) {
  const packagePath = join(root, "package.json");
  const rawPackage = await readText(packagePath);
  if (!rawPackage) return undefined;

  const managers = new Set();
  const lockfiles = [];
  for (const [lockfile, manager] of LOCKFILES) {
    if (await exists(join(root, lockfile))) {
      managers.add(manager);
      lockfiles.push(lockfile);
    }
  }
  if (managers.size > 1) {
    return {
      status: "ambiguous",
      gates: [],
      sources: ["package.json", ...lockfiles],
      conflicts: [`Conflicting JavaScript lockfiles select ${[...managers].sort().join(", ")}.`],
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(rawPackage);
  } catch {
    return {
      status: "ambiguous",
      gates: [],
      sources: ["package.json"],
      conflicts: ["package.json is not valid JSON."],
    };
  }
  const scripts = manifest && typeof manifest === "object" && !Array.isArray(manifest)
    ? manifest.scripts
    : undefined;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return { status: "none", gates: [], sources: ["package.json", ...lockfiles], conflicts: [] };
  }

  let manager = [...managers][0];
  if (!manager && typeof manifest.packageManager === "string") {
    const declared = manifest.packageManager.split("@", 1)[0];
    if (["npm", "pnpm", "yarn", "bun"].includes(declared)) manager = declared;
  }
  if (!manager) {
    return {
      status: "ambiguous",
      gates: [],
      sources: ["package.json"],
      conflicts: ["No JavaScript lockfile or supported packageManager declaration selects a runner."],
    };
  }

  const names = Object.keys(scripts);
  const selected = names.includes("check")
    ? ["check"]
    : ["typecheck", "lint", "test", "build"].filter((name) => names.includes(name));
  return {
    status: selected.length > 0 ? "ready" : "none",
    gates: selected.map((name) =>
      gate(packageManagerCommand(manager, name), root, "package.json", name === "check" ? "aggregate" : name)),
    sources: ["package.json", ...lockfiles],
    conflicts: [],
  };
}

async function discoverNonJavaScriptGates(root) {
  if (await exists(join(root, "Cargo.toml"))) {
    return [
      gate("cargo test", root, "Cargo.toml", "test"),
      gate("cargo check", root, "Cargo.toml", "static"),
    ];
  }
  if (await exists(join(root, "go.mod"))) {
    return [gate("go test ./...", root, "go.mod", "test")];
  }
  return [];
}

/**
 * Discover commands from checked-in repository evidence. The helper never
 * executes a command and deliberately returns "ambiguous" instead of guessing.
 */
export async function discoverRepositoryGates(projectRoot) {
  const root = resolve(projectRoot);
  const wrapper = await discoverWrapper(root);
  if (wrapper) {
    return { status: "ready", gates: [wrapper], sources: [wrapper.source], conflicts: [] };
  }

  const javascript = await discoverJavaScriptGates(root);
  if (javascript?.status === "ready" || javascript?.status === "ambiguous") {
    return javascript;
  }

  const nonJavaScript = await discoverNonJavaScriptGates(root);
  if (nonJavaScript.length > 0) {
    return {
      status: "ready",
      gates: nonJavaScript,
      sources: [...new Set(nonJavaScript.map((entry) => entry.source))],
      conflicts: [],
    };
  }

  return javascript ?? { status: "none", gates: [], sources: [], conflicts: [] };
}
