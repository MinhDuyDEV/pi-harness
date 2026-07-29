export type ReleaseMode = "local" | "registry";

export function releaseEnvironment(
  mode: ReleaseMode,
  baseEnvironment?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;

export interface ReleaseStep {
  name: string;
  cmd: string;
  args: string[];
}

export function releaseSteps(
  mode: ReleaseMode,
  options?: { audit?: boolean },
): ReleaseStep[];
