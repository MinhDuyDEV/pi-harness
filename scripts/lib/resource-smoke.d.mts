import type { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

type DiagnosticResult<T> = T & { diagnostics?: unknown[] };

export interface PackageResourceLoader {
  getExtensions(): { extensions: Array<{ path: string }>; errors?: unknown[] };
  getSkills(): DiagnosticResult<{ skills: Array<{ filePath: string }> }>;
  getPrompts(): DiagnosticResult<{ prompts: Array<{ path: string }> }>;
  getThemes(): DiagnosticResult<{ themes: Array<{ path: string }> }>;
}

export function assertResourcesLoad(
  loader: DefaultResourceLoader,
  options: { root: string },
): string;

export function assertPackageResourcesLoad(
  loader: PackageResourceLoader,
  options: { packageRoot: string },
): { extensions: number; skills: number; prompts: number; themes: number };

export function assertPathsWithinRoot(
  paths: Array<string | undefined | null>,
  root: string,
): void;
