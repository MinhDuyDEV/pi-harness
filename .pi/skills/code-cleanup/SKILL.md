---
name: code-cleanup
description: Use after behavior is working but the diff is noisy, repetitive, over-complicated, or obviously AI-shaped - lock behavior first, then simplify the changed code and re-verify without expanding scope
version: 1.0.0
tags: [refactor, code-quality, workflow]
dependencies: [verification-before-completion]
agent_types: [planner, worker, reviewer]
tools: []
---

# Code Cleanup

## When to Use

- Tests/build/typecheck already pass, but the changed code is clumsy
- A feature works, but the diff contains duplication, over-nesting, dead code, or awkward naming
- You want a final simplification pass before review or merge
- You encountered a "broken window" (messy code, bad pattern, dead comment) that needs boarding up

## When NOT to Use

- Behavior is still broken or unverified
- You are tempted to redesign architecture under the cover of "cleanup"
- The cleanup would spread into unrelated files
- You have not yet established how to prove nothing broke

## Core Principle

**Lock behavior first. Then simplify. Then re-verify.**

No cleanup claim counts unless the same verification still passes after the cleanup edits.

## Why Cleanup Matters: Software Entropy

Left unrepaired, every messy piece of code gives permission for the next one. This is the "broken windows" theory from *The Pragmatic Programmer*: a bad design, wrong decision, or poor code left in place signals that quality doesn't matter — and more broken windows follow.

AI agents accelerate this. A messy module invites the next AI to add more mess. A clean module with clear patterns invites the next AI to follow those patterns. Cleanup is not cosmetic — it's **entropy containment**. It's the difference between a codebase that decays with each AI pass and one that stabilizes.

**When full cleanup is impossible, board it up.** Add a comment marking the issue, stub out the dead path, isolate the bad code behind a clear boundary. The goal is to contain the damage so it doesn't spread, even if you can't fix it right now.

## Cleanup Targets

Prefer cleanup that removes friction without changing behavior:

- delete dead branches, unused variables, stale comments
- collapse repeated logic when the abstraction is already obvious
- simplify conditionals and nesting
- improve names where the blast radius is small and verified
- remove AI-ish filler comments, duplicated guards, or ceremony
- **fix broken windows**: inconsistent patterns, dead TODOs, misnamed functions, formatting rot

Avoid:

- cross-system rewrites
- new abstractions with speculative value
- changing public APIs unless explicitly requested
- moving many files just because structure feels imperfect

## Process

### Phase 1: Lock Behavior

1. Identify the verification commands that prove the current behavior
2. Run them and save the baseline result
3. List the exact files that are eligible for cleanup

### Phase 2: Create a Cleanup Plan

Use a small table before editing:

| File | Smell | Planned simplification | Risk |
| ---- | ----- | ---------------------- | ---- |
| ...  | ...   | ...                    | ...  |

Rules:
- Prefer deletion over abstraction
- Prefer local simplification over shared utilities
- If risk is medium or higher, make smaller passes

### Phase 3: Simplify

Apply cleanup in small, reviewable edits:

1. Make one simplification
2. Re-run the relevant verification
3. Continue only if behavior remains locked

### Phase 4: Re-verify

Re-run the same commands used to lock behavior.

Minimum acceptable output:
- what was simplified
- what was deleted
- what verification was rerun
- any remaining ugly areas intentionally left alone

## Output Checklist

- [ ] Baseline verification captured before cleanup
- [ ] Only changed files or directly adjacent support files touched
- [ ] Same verification rerun after cleanup
- [ ] Simplifications reported concretely
- [ ] No hidden architecture drift


## Consolidated Simplification Workflow

This is the canonical active simplification skill. It absorbs code-simplification. Only simplify after behavior is protected by tests or explicit verification. Avoid broad refactors bundled with feature work.


## Agent-Skills Compatibility

This skill is Pi's canonical equivalent of `code-simplification`: simplify working code while preserving exact behavior, respecting Chesterton's Fence, and re-verifying after cleanup.
