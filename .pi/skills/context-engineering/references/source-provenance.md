# Source provenance and external API research

Use this reference when a task depends on an unfamiliar library, version-specific
API, external protocol, or current best practice. Local code and tests describe
the behavior this repository actually supports; official documentation and
specifications are the authority for behavior that is not established locally.

## Source hierarchy

1. Local implementation, tests, lockfiles, and checked-in rules.
2. Official documentation, specifications, and release notes for the installed
   version.
3. Maintained upstream source and official examples.
4. Maintainer-authored articles.
5. Community material only when higher-ranked sources are unavailable; record its
   date and uncertainty.

When sources conflict, prefer the higher-ranked source and call out the
conflict. For a deep dependency source dive, pair this workflow with `opensrc`.

## Workflow

1. State the exact API or behavior question.
2. Search local precedent before browsing.
3. Verify the package/version in `package.json` and the lockfile.
4. Read the authoritative source and extract only implementation-relevant facts.
5. Compare conflicting sources and test the smallest assumption.
6. Cite the URL, spec section, or local file/line in the decision.
7. Mark unresolved assumptions as unverified instead of presenting them as facts.

## Completion evidence

- Version compatibility was checked.
- Non-trivial external claims have a source citation.
- The recommendation names the concrete import, option, or integration shape.
- Remaining uncertainty and the validation that would remove it are explicit.

