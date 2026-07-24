---
name: superpi
description: Use when tuning Pi skill discovery or routing; keep skill selection evidence-based and avoid loading unnecessary
  context.
disable-model-invocation: true
---

# Pi skill routing

Pi discovers skill descriptions automatically and loads full `SKILL.md` content only when needed. Do not block a user request by asking them to choose a skill first.

1. Inspect the task and repository state.
2. Load only the smallest relevant skill set.
3. Prefer project-specific evidence over generic skill assumptions.
4. If a skill refers to an unavailable tool, package, or path, report it and use a native fallback.
5. Avoid loading overlapping skills merely because several descriptions match.

Optional integrations should stay disabled until their dependencies are verified.

For a new feature, combine planning with the narrow implementation/testing skills. For a bug, start with diagnosis/root-cause tracing. For completion, use verification and code-quality checks.
