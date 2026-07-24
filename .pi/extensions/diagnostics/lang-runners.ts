import fs from "node:fs";
import path from "node:path";
import { buildBlockFromRawOutput } from "./format.ts";
import { pathWhich } from "./path.ts";
import { defaultTimeoutMs, runCli } from "./subprocess.ts";
import type { DiagnosticBlockMeta, RunBlockResult } from "./types.ts";

export interface DiagnosticRunner {
  name: string;
  label: string;
  extensions: string[];
  detect(root: string): boolean;
  resolve(root: string): { bin: string; args: string[] } | null;
}

function nodeBin(root: string, name: string): string {
  return path.join(root, "node_modules", ".bin", name);
}

function resolveCommand(name: string, args: string[]): { bin: string; args: string[] } | null {
  const bin = pathWhich(name);
  return bin ? { bin, args } : null;
}

function createRunner(
  name: string,
  label: string,
  extensions: string[],
  detect: (root: string) => boolean,
  resolve: (root: string) => { bin: string; args: string[] } | null,
): DiagnosticRunner {
  return { name, label, extensions, detect, resolve };
}

export const LANG_DIAGNOSTICS: DiagnosticRunner[] = [
  createRunner("typescript", "TypeScript (tsc)", [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"],
    (root) => fs.existsSync(path.join(root, "tsconfig.json")),
    (root) => {
      const localTsc = nodeBin(root, process.platform === "win32" ? "tsc.cmd" : "tsc");
      return fs.existsSync(localTsc) ? { bin: localTsc, args: ["--noEmit", "--pretty", "false"] } : resolveCommand("tsc", ["--noEmit", "--pretty", "false"]);
    }),
  createRunner("rust", "Rust (cargo check)", [".rs"],
    (root) => fs.existsSync(path.join(root, "Cargo.toml")),
    () => resolveCommand("cargo", ["check", "--quiet"])),
  createRunner("go", "Go (go vet)", [".go"],
    (root) => fs.existsSync(path.join(root, "go.mod")),
    () => resolveCommand("go", ["vet", "./..."])),
  createRunner("python", "Python (ruff → mypy)", [".py", ".pyi"],
    (root) => ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"].some((file) => fs.existsSync(path.join(root, file))),
    () => resolveCommand("ruff", ["check", "."]) ?? resolveCommand("mypy", ["."])),
];

export const EXT_TO_RUNNERS = new Map<string, DiagnosticRunner[]>();
for (const runner of LANG_DIAGNOSTICS) {
  for (const ext of runner.extensions) {
    const list = EXT_TO_RUNNERS.get(ext) || [];
    list.push(runner);
    EXT_TO_RUNNERS.set(ext, list);
  }
}

export function detectLanguages(root: string): string[] {
  return LANG_DIAGNOSTICS.filter((r) => r.detect(root)).map((r) => r.name);
}

export function selectRunners(
  root: string,
  languages: string[] | undefined,
  file: string | undefined,
): DiagnosticRunner[] {
  let runners = LANG_DIAGNOSTICS.filter((r) => r.detect(root));

  if (languages?.length) {
    const set = new Set(languages);
    runners = runners.filter((r) => set.has(r.name));
  }

  if (file) {
    const ext = path.extname(file).toLowerCase();
    const byExt = EXT_TO_RUNNERS.get(ext) || [];
    const names = new Set(byExt.map((r) => r.name));
    runners = runners.filter((r) => names.has(r.name));
  }

  return runners;
}

export async function runOne(
  runner: DiagnosticRunner,
  root: string,
  signal?: AbortSignal,
): Promise<RunBlockResult | null> {
  const cmd = runner.resolve(root);
  if (!cmd) return null;

  const result = await runCli({
    bin: cmd.bin,
    args: cmd.args,
    cwd: root,
    signal,
    timeoutMs: defaultTimeoutMs(),
  });

  if (result.enoent) return null;

  const output = (result.stderr || result.stdout || "").trim();
  const meta = createDiagnosticMeta(runner.name, result.exitCode, result.elapsedMs);
  if (!output) return { text: "", meta };

  return { text: buildBlockFromRawOutput(runner.label, output), meta };
}

function createDiagnosticMeta(id: string, exitCode: number | null, elapsedMs: number): DiagnosticBlockMeta {
  return { id, exitCode, ok: exitCode === 0, elapsedMs };
}

export async function runLanguages(
  root: string,
  options: {
    languages?: string[];
    file?: string;
    signal?: AbortSignal;
  },
): Promise<RunBlockResult[]> {
  const runners = selectRunners(root, options.languages, options.file);
  const results = await Promise.all(runners.map((r) => runOne(r, root, options.signal)));
  return results.filter((r): r is RunBlockResult => r !== null);
}