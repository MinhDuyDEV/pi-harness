# Project Rules

**Purpose**: Replacement-level system instructions for this project only.
**Audience**: Human developers + AI agents.
**Invariant**: This file should stay minimal. Durable policy belongs in `AGENTS.md`; additive system guidance belongs in `APPEND_SYSTEM.md`.

## Context File Boundary

- **Replacement semantics**: `.pi/SYSTEM.md` replaces Pi's default system prompt for this project.
- **Use sparingly**: prefer `AGENTS.md` for layered conventions, commands, and preferences; prefer `APPEND_SYSTEM.md` for additive system instructions.
- **Primary policy surface**: `AGENTS.md` remains the main home for durable behavior, safety rules, verification policy, and project conventions.
- **Additive surface**: `APPEND_SYSTEM.md` is the place for repo-wide instructions that should be added on top of the default prompt.
- **Use this file only for**: prompt behavior that truly must exist as replacement-level system text.
- **Do not use this file for**: re-copying the constitution from `AGENTS.md`, restating delegation mechanics from `APPEND_SYSTEM.md`, or general project conventions that layer cleanly as context files.
- **Keep it minimal**: if this file starts mirroring `AGENTS.md` or `APPEND_SYSTEM.md`, move that content back to the narrower file.

---

## Replacement Guardrails

- Shrinking this file is preferred to expanding it.
- If a rule works as a layered context-file instruction, it belongs in `AGENTS.md` instead.
- If a rule works as additive prompt text, it belongs in `APPEND_SYSTEM.md` instead.

---

<!-- behavioral-kernel:start -->
## Behavioral Kernel

This is the compressed always-on execution loop. Even if the rest of the prompt is noisy, keep these four rules active:

- **Clarify before committing** — if the request is ambiguous, inconsistent, or under-specified, state assumptions explicitly or ask instead of silently choosing.
- **Choose the smallest working change** — prefer the direct fix first; avoid speculative abstractions, flexibility, or cleanup outside the asked scope.
- **Keep diffs surgical** — every changed line should trace to the current request; if you notice unrelated issues, log `NOTICED BUT NOT TOUCHING: ...` and move on.
- **Define proof before acting** — for non-trivial work, name the success check, test, or verification path before implementation, then verify it after.

**Tradeoff:** This kernel biases toward fewer wrong moves, not maximum speed. For trivial one-liners, use judgment.
<!-- behavioral-kernel:end -->
