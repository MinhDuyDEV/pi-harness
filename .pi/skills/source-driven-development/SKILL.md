---
name: source-driven-development
description: Grounds external-library and API decisions in authoritative sources with citations or explicit unverified markers. Use when adopting an unfamiliar library, or when an error suggests external API misuse.
metadata:
  version: 1.0.0
  tags:
  - research
  - implementation
  - verification
  dependencies: []
---

# Source-Driven Development

## Overview

Framework guesses become bugs. Source-driven work verifies behavior against authoritative references before implementation.

Core principle: cite the source for non-trivial external API decisions, or mark the decision as unverified.

## When to Use

- New or unfamiliar library/framework/API.
- Version-specific behavior matters.
- Choosing between packages or integration patterns.
- Error suggests external API misuse.
- User asks to research current best practice.

## When NOT to Use

- Pure local codebase questions; use code search/explore.
- Stable project conventions already cover the behavior.
- Trivial syntax you can verify from existing code.

## Source Hierarchy

1. Local code, tests, and lockfiles — what the project actually does today.
2. Official docs, specs, release notes.
3. Maintained source code and examples from the library itself.
4. Maintainer-authored articles.
5. Community posts only when higher sources are absent — cite with dates and caveats.

Higher-ranked sources win on conflicts. For deep source dives into a dependency's repository, use the `opensrc` skill as a tool-specific companion.

## Workflow

1. State the question precisely.
2. Check memory/local docs for prior decisions.
3. Retrieve authoritative sources.
4. Verify version compatibility with the project.
5. Compare sources if guidance conflicts.
6. Extract only the implementation-relevant facts.
7. Cite URLs or source refs in the recommendation.
8. Mark unresolved uncertainty explicitly.

## Common Rationalizations

| Rationalization | Rebuttal |
| --- | --- |
| "I know this API" | APIs change; verify version-specific behavior. |
| "A blog said so" | Blogs lose to official docs/source. |
| "The package name is obvious" | Similar packages differ in security and maintenance. |
| "Citations slow us down" | A bad integration costs more than a source check. |

## Red Flags

- Unfamiliar API used without citation or local precedent.
- Community answer conflicts with official docs.
- Version in docs differs from package version.
- Agent invents options, flags, or imports.
- Research dump has no recommendation.

## Verification

- Key claims cite authoritative sources.
- Project/library versions are considered.
- Implementation recommendation is specific.
- Unverified assumptions are labeled.

## Skill Result Contract

```xml
<skill_result>
  <skill>source-driven-development</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Sources consulted and version checks</evidence>
  <artifacts>Research notes, citations, implementation recommendation</artifacts>
  <risks>Unverified claims, stale docs, conflicting sources, or none</risks>
</skill_result>
```
