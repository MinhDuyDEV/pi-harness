---
name: opensrc
description: Fetches and investigates package source (npm, PyPI, crates.io, GitHub) with a question-driven workflow. Use when a library behaves unexpectedly, docs don't explain a behavior, or when planning a migration.
metadata:
  version: 1.1.0
  tags:
  - research
  - integration
  - source-code
  dependencies: []
---

# Open Source Code Investigation

## When to Use

Library behaves unexpectedly; need to understand how a function works internally; types/docs don't explain a behavior; debugging a dep issue; "is this safe to use?"; planning a migration; reverse-engineering a pattern.

## When NOT to Use

Good docs and types answer; behavior is standard and obvious; "I just want to use it" (debug with logging).

## Core Principle

**Read the source before forming an opinion about the library.** Types and docs lie. Source is the contract. When the docs say X and the code does Y, the code is right.

## Investigation Workflow

1. **State the question.** "How does X work?", "Why does Y happen?", "What is the actual behavior of Z?"
2. **Locate the source.** GitHub repo, npm tarball, or the dep's `node_modules/<pkg>/`. The repo is usually the most readable.
3. **Read the README + docs first.** 30 seconds can save 30 minutes.
4. **Navigate the code.** Find the entry point. Follow the call graph for the specific behavior.
5. **Read the test file.** Tests document the intended behavior. Often clearer than the impl.
6. **Verify your understanding.** Write a tiny test that exercises the behavior. Did you predict the output?
7. **Note the version.** `git log` to see when the behavior was added / changed.

## Common Targets

| Question | Where |
|---|---|
| "How does X work?" | The function's source file |
| "Why is X slow?" | The function + callers + trace |
| "What is Y's behavior?" | Types + tests + source |
| "Is X safe?" | Audit (eval, exec, fs.write) |
| "When was X added?" | `git log` on the file |
| "Known bug?" | GitHub issues |

## Security Tells While Reading

`eval`, `new Function` in unexpected places; `child_process.exec` with user input; `fs.writeFile` with untrusted paths; network calls to hardcoded domains; hidden side effects in `import` / `require`; deps on packages that don't exist.

## References

- See [references/cli-usage.md](references/cli-usage.md) for the opensrc CLI commands and flags.
- See [references/registry-support.md](references/registry-support.md) for npm/PyPI/crates.io/GitHub specifics.
- See [references/source-structure.md](references/source-structure.md) for where fetched source lands and how packages are laid out.
- See [references/example-workflow.md](references/example-workflow.md) for a worked end-to-end investigation.
- See [references/analysis-tips.md](references/analysis-tips.md), [references/common-patterns.md](references/common-patterns.md), and [references/architecture.md](references/architecture.md) for reading strategies and tool internals; [references/anti-patterns.md](references/anti-patterns.md) and [references/further-reading.md](references/further-reading.md) for pitfalls and sources.

## Red Flags

Reading source without a question (drift into reading the whole codebase); "I think it works like X" without reading; trusting docs/README over code ("docs say X" — verify); reading the wrong version (check `package.json` and the lockfile); not running a verification test while reading; debugging without a hypothesis; skipping the tests (they document intent); "I don't need to look" (until it breaks); stuck in dep hell (find the boundary).
