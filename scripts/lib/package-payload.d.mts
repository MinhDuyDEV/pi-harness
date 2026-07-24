/** Type declarations for scripts/lib/package-payload.mjs (see source for behavior). */

export function normalizePackPath(p: string): string;

export interface PayloadContract {
  requiredExact: string[];
  requiredPatterns: { re: RegExp; label: string }[];
  forbidden: RegExp[];
}

export const defaultPayloadContract: PayloadContract;

export function validatePackagePayload(
  paths: string[],
  contract?: PayloadContract,
): { errors: string[] };