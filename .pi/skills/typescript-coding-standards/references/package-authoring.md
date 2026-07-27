# TypeScript package authoring

Use this reference when creating a package or changing `package.json` in a
TypeScript workspace.

## Package contract

One package has one concern. The `exports` field is the public API: files not
exported there are private even when they exist in `src/`. Prefer an explicit
`src/index.ts`, `dist/` output, colocated unit tests, README, and a changelog for
published packages.

```json
{
  "name": "@scope/package",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": { "build": "tsc -p tsconfig.build.json", "test": "node --test" }
}
```

Put `types` before runtime conditions. Add subpath exports deliberately. For
platform-specific packages, order the most specific condition first (`node`
plus `import`/`require`) and finish with a `default` browser-safe branch.

## Workspace decisions

- A monorepo package owns its `package.json` and `tsconfig` (extending the root).
- Internal dependencies use the workspace protocol (`workspace:*`) or the
  repository's catalog; pin a release version only at publish time.
- Shared pnpm versions belong in `pnpm-workspace.yaml` catalog entries.
- Internal packages may be private and use direct imports; published packages
  expose only explicit API subpaths and never accidentally publish internals.
- Use peer dependencies for host-provided frameworks; keep runtime dependencies
  minimal and avoid bundling consumer-owned dependencies.

## Pre-publish checks

Build declarations and runtime output, import every exported subpath from a
consumer fixture, inspect the packed tarball, and verify `files`, conditional
exports, peer dependencies, and changelog/version are correct. Avoid barrel
files that hide cycles or expose an accidental API.

