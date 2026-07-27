export const SUITE_PACKAGE_NAMES: readonly string[];
export const SUITE_PUBLISH_ORDER: readonly string[];

export interface SuitePin {
  source: string;
  spec: string;
  version: string;
}

export function parseSuitePins(settings: unknown): Record<string, SuitePin>;
export function readSuitePins(settingsPath: string): Record<string, SuitePin>;
