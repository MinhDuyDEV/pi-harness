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

export const LANG_DIAGNOSTICS: DiagnosticRunner[] = [
  {
    name: "typescript",
    label: "TypeScript (tsc)",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"],
    detect(root) {
      return fs.existsSync(path.join(root, "tsconfig.json"));
    },
    resolve(root) {
      const localTsc = nodeBin(root, process.platform === "win32" ? "tsc.cmd" : "tsc");
      if (fs.existsSync(localTsc)) {
        return { bin: localTsc, args: ["--noEmit", "--pretty", "false"] };
      }
      return { bin: "npx", args: ["--yes", "tsc", "--noEmit", "--pretty", "false"] };
    },
  },
  {
    name: "rust",
    label: "Rust (cargo check)",
    extensions: [".rs"],
    detect(root) {
      return fs.existsSync(path.join(root, "Cargo.toml"));
    },
    resolve() {
      const cargo = pathWhich("cargo");
      if (!cargo) return null;
      return { bin: cargo, args: ["check", "--quiet"] };
    },
  },
  {
    name: "go",
    label: "Go (go vet)",
    extensions: [".go"],
    detect(root) {
      return fs.existsSync(path.join(root, "go.mod"));
    },
    resolve() {
      const govet = pathWhich("go");
      if (!govet) return null;
      return { bin: govet, args: ["vet", "./..."] };
    },
  },
  {
    name: "python",
    label: "Python (ruff → mypy)",
    extensions: [".py", ".pyi"],
    detect(root) {
      return (
        fs.existsSync(path.join(root, "pyproject.toml")) ||
        fs.existsSync(path.join(root, "setup.py")) ||
        fs.existsSync(path.join(root, "setup.cfg")) ||
        fs.existsSync(path.join(root, "requirements.txt")) ||
        fs.existsSync(path.join(root, "Pipfile"))
      );
    },
    resolve() {
      const ruff = pathWhich("ruff");
      if (ruff) return { bin: ruff, args: ["check", "."] };
      const mypy = pathWhich("mypy");
      if (mypy) return { bin: mypy, args: ["."] };
      return null;
    },
  },
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
  if (!output) {
    const meta: DiagnosticBlockMeta = {
      id: runner.name,
      exitCode: result.exitCode,
      ok: result.exitCode === 0,
      elapsedMs: result.elapsedMs,
    };
    return { text: "", meta };
  }

  const text = buildBlockFromRawOutput(runner.label, output);
  const meta: DiagnosticBlockMeta = {
    id: runner.name,
    exitCode: result.exitCode,
    ok: result.exitCode === 0,
    elapsedMs: result.elapsedMs,
  };
  return { text, meta };
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