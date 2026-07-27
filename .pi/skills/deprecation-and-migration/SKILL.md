---
name: deprecation-and-migration
description: Removes or replaces APIs without breaking users — deprecation lifecycle, migration paths, codemods, staged rollout. Use when deprecating an API, planning a breaking change, or migrating major versions.
metadata:
  version: 1.0.0
  tags:
  - architecture
  - workflow
  dependencies: []
---

# Deprecation & Migration

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Deprecate first, remove later.** Users need time to migrate.
- **One major version per breaking change.** Don't bundle breaks.
- **Document the migration path.** "Deprecated" without "do this instead" is a wall, not a path.
- **Keep both working during deprecation.** Until the removal version.
- **Communicate in changelog, docs, runtime warnings.** All three.
</EXTREMELY-IMPORTANT>

## Deprecation Lifecycle

```
[1] Add @deprecated JSDoc (since-version, replacement, removal version,
    migration link) + a rate-limited runtime warning
[2] Document the migration path: TL;DR, step-by-step, codemod
[3] Wait at least one minor version (or 3 months, whichever longer)
[4] Remove in next major version
[5] Changelog: "Removed X. Use Y. Migration: <link>"
```

Skipping steps breaks trust. The cadence is conservative on purpose.

The migration guide serves three audiences: the TL;DR is for the impatient, the step-by-step is for the careful, the codemod is for the many.

## The Codemod Test

Ship a codemod (`scripts/codemod/`, jscodeshift or ast-grep) tested on real code, not just samples. **If you can't write a codemod, the migration is too complex for a deprecation.** Reconsider the design.

## Staged Rollout

For breaking behavior changes in libraries: feature-flag the new behavior, default to old, opt-in for early adopters, flip the default in the next major.

## Red Flags

Removal without a deprecation period; `@deprecated` without a runtime warning or changelog entry; "deprecated" without a migration guide; guide that is only the TL;DR; codemod untested on real code; deprecation period shorter than one minor version; multiple breaks bundled into one major; asking users to read source to migrate; no opt-in for early adopters; `@deprecated` forever with no removal date (that's a feature, not a migration); "we removed it, use the new one" with no link.
