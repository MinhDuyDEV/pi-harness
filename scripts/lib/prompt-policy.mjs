/**
 * Pure prompt-policy primitives for cross-resource validation.
 *
 * Prompt templates declare skill dependencies as `skill: name`. The declaration
 * is machine-checkable without pretending a dedicated skill tool exists in every
 * Pi installation.
 */

const SKILL_REF_RE = /^\s*(?:-\s*)?skill:\s*`?([a-z0-9][a-z0-9-]*)`?\s*$/gim;

/**
 * Extract skill names from declarative references, in source order.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractSkillRefs(content) {
  const names = [];
  for (const match of content.matchAll(SKILL_REF_RE)) names.push(match[1]);
  return names;
}

/**
 * Validate every prompt skill reference against the shipped skill inventory.
 *
 * @param {Record<string, string>} prompts
 * @param {string[]} skillNames
 * @returns {{ errors: string[] }}
 */
export function validatePromptSkillRefs(prompts, skillNames) {
  const known = new Set(skillNames);
  const errors = [];
  for (const [name, content] of Object.entries(prompts)) {
    for (const ref of extractSkillRefs(content)) {
      if (!known.has(ref)) errors.push(`${name}: references unknown skill "${ref}"`);
    }
  }
  return { errors };
}
