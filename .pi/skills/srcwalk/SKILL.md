---
name: srcwalk
description: "User-invoked: load via /skill:srcwalk when configuring or using the required srcwalk code navigator. It provides exact reads, structural discovery, callers/callees, dependencies, impact assessment, context packets, reviews, and project overviews."
disable-model-invocation: true
---

# srcwalk — structural code navigation

`srcwalk` is the required external code-navigation CLI, not a Pi extension. Run
the installation step below before starting Pi, and treat a missing executable as
a setup blocker rather than silently switching to raw navigation tools.

For non-trivial navigation, run this first and read the complete output:

```sh
srcwalk guide
```

The installed binary's guide is the source of truth for command routing and
caveats. Use `--help` only for flags. Prefer intent-first commands:

- `srcwalk overview --scope <dir>` — orient in a repository.
- `srcwalk discover <query> --scope <dir>` — find definitions, occurrences,
  files, text, comments, or access evidence.
- `srcwalk <path>:<line-or-range>` / `srcwalk show ...` — read bounded source.
- `srcwalk context <path>:<symbol>` — produce a bounded evidence packet.
- `srcwalk trace callers|callees <symbol> --scope <dir>` — inspect static call
  relationships; treat unresolved/ambiguous edges as caveated evidence.
- `srcwalk deps <path>` — inspect outbound imports and inbound dependents.
- `srcwalk assess <target>` — inspect likely blast radius before editing.
- `srcwalk review --staged|--working-tree` and `srcwalk diff ...` — review Git
  changes with exact follow-up reads.

Keep scope and budgets bounded. `srcwalk` provides source evidence, not runtime
proof, semantic type resolution, or a substitute for tests. Confirm important
claims with exact reads and the project's checks. Use `rg` for regex searches or
pure text/path matching, and ordinary shell tools when srcwalk does not support
the file or operation.

## Installation

From a consumer repository, install the pinned major-compatible CLI separately:

```sh
npm install -g srcwalk
# or use it without a global install:
npx --yes srcwalk guide
```

The npm package downloads and verifies the platform binary. A package manager
or system policy may require an explicit install; pi-harness intentionally does
not run downloads during package installation or Pi startup.
