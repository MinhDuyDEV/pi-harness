export type ReleaseMode = "local" | "registry";

export function releaseEnvironment(
  mode: ReleaseMode,
  baseEnvironment?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;
