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

/** Maximum model-visible skills. Keep one slot free for an intentional addition. */
export const MAX_VISIBLE_SKILLS = 36;

/** Combined description-character budget across all model-visible skills. */
export const MAX_DESCRIPTION_CHARS = 7500;

/** Minimum reserved description budget, asserted by the skill catalog test. */
export const MIN_DESCRIPTION_HEADROOM = 400;
