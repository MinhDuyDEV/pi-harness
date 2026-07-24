/** Type declarations for scripts/lib/prompt-policy.mjs (see source for behavior). */

export function extractSkillRefs(content: string): string[];

export function validatePromptSkillRefs(
  prompts: Record<string, string>,
  skillNames: string[],
): { errors: string[] };