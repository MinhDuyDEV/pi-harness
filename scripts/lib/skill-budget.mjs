/**
 * Shared skill budget constants — single source of truth for the validator
 * (scripts/validate-skills.mjs), the resource smoke assertions
 * (scripts/lib/resource-smoke.mjs), and the compression tests
 * (tests/skill-compression.test.ts).
 */

/** A SKILL.md body (excluding frontmatter) may never exceed this many words. */
export const HARD_WORD_CAP = 700;

/** Compression target for SKILL.md bodies; the compression tests enforce this. */
export const TARGET_WORD_CAP = 600;

/** Maximum number of model-visible skills (no disable-model-invocation). */
export const MAX_VISIBLE_SKILLS = 40;

/** Combined description-character budget across all model-visible skills. */
export const MAX_DESCRIPTION_CHARS = 8000;
