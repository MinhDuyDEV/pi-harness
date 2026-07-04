export type DiagnosticsScope = "full" | "changed";

export interface DiagnosticBlockMeta {
  id: string;
  exitCode: number | null;
  ok: boolean;
  truncated?: boolean;
  fullOutputPath?: string;
  elapsedMs?: number;
}

export interface DiagnosticsDetails {
  /** Pi session working directory */
  cwd: string;
  /** Directory where runners executed (may be parent of cwd) */
  projectRoot: string;
  walkedUp?: boolean;
  scope: DiagnosticsScope;
  blocks: DiagnosticBlockMeta[];
  detectedLanguages: string[];
}

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  elapsedMs: number;
  killed?: boolean;
  enoent?: boolean;
}

export interface RunBlockResult {
  text: string;
  meta: DiagnosticBlockMeta;
}

export interface ResolvedDiagnosticsParams {
  scope: DiagnosticsScope;
  changedSince: string;
  languages: string[] | undefined;
  includeFallow: boolean;
  includeAislop: boolean;
  file: string | undefined;
}