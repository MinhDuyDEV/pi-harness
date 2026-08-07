import { Type, type Static } from "typebox";
import { hasTsProject, resolveDiagnosticsProjectRoot } from "./project-root.ts";
import type { DiagnosticsScope, ResolvedDiagnosticsParams } from "./types.ts";

export const diagnosticsParamsSchema = Type.Object({
  scope: Type.Optional(
    Type.Union([Type.Literal("full"), Type.Literal("changed")], {
      description: 'Use "changed" to scope Fallow to git diff since a verified changedSince baseline.',
    }),
  ),
  changedSince: Type.Optional(
    Type.String({
      maxLength: 200,
      description: "Git ref for Fallow changed scope. Defaults to PI_DIAGNOSTICS_CHANGED_SINCE or a verified auto baseline.",
    }),
  ),
  languages: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Filter language runners by id: typescript, rust, go, python.',
    }),
  ),
  includeFallow: Type.Optional(
    Type.Boolean({ description: "Run Fallow for TS/JS projects (default: true when tsconfig.json exists)." }),
  ),
  includeAislop: Type.Optional(
    Type.Boolean({
      description:
        "Run full-project aislop scan (default: false when PI_AISLOP_AUTO or PI_DIAGNOSTICS_SKIP_AISLOP is set).",
    }),
  ),
  file: Type.Optional(
    Type.String({
      description: "If set, only language runners matching this file extension run (Fallow still project-scoped).",
    }),
  ),
});

export type DiagnosticsParams = Static<typeof diagnosticsParamsSchema>;

export function defaultChangedSince(): string {
  return process.env.PI_DIAGNOSTICS_CHANGED_SINCE || "auto";
}

export function defaultIncludeAislop(): boolean {
  if (process.env.PI_DIAGNOSTICS_SKIP_AISLOP === "true") return false;
  if (process.env.PI_AISLOP_AUTO === "true") return false;
  return true;
}

export function resolveParams(
  raw: Record<string, unknown>,
  cwd: string,
): ResolvedDiagnosticsParams {
  const scope = (raw.scope as DiagnosticsScope | undefined) || "full";
  const changedSince =
    typeof raw.changedSince === "string" && raw.changedSince.trim()
      ? raw.changedSince.trim()
      : defaultChangedSince();

  const languages = Array.isArray(raw.languages)
    ? raw.languages.filter((x): x is string => typeof x === "string")
    : undefined;

  const { projectRoot } = resolveDiagnosticsProjectRoot(cwd);
  let includeFallow = raw.includeFallow as boolean | undefined;
  if (includeFallow === undefined) includeFallow = hasTsProject(projectRoot);

  let includeAislop = raw.includeAislop as boolean | undefined;
  if (includeAislop === undefined) includeAislop = defaultIncludeAislop();

  const file = typeof raw.file === "string" && raw.file.trim() ? raw.file.trim() : undefined;

  return { scope, changedSince, languages, includeFallow, includeAislop, file };
}
