---
name: opencode-ts-package
version: 1.0.0
description: "Use when creating a new npm package in a TypeScript monorepo, setting up package.json exports and build configuration, structuring internal vs published packages, handling platform-specific code with conditional imports, or configuring workspace/catalog dependency management. MUST load before creating a new package or modifying package.json in an Effect-based monorepo."
---

# TypeScript Package (Effect-style)

## Iron Laws

<EXTREMELY-IMPORTANT>
- **One package = one concern.** If you need a section, it's a section header in the README, not a subdirectory.
- **`exports` field is the API.** Everything not in `exports` is private, even if it has `index.ts`.
- **No barrel files for internal code.** Direct imports only. Barrels hide cycles and break tree-shaking.
- **Build via `tsc` + `tsup` (or similar).** No custom bundlers. No webpack for libraries.
- **Types ship with source.** `"types": "./dist/index.d.ts"` first, code second.
</EXTREMELY-IMPORTANT>

## Package Layout

```
my-package/
├── package.json
├── tsconfig.json
├── src/
│   └── index.ts          # public API only
├── dist/                 # build output (gitignored)
├── test/
│   └── *.test.ts
├── README.md
└── CHANGELOG.md
```

For monorepo, each package has its own `package.json`, `tsconfig.json` (extends root), and `src/`.

## package.json (minimal)

```json
{
  "name": "@scope/my-package",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "node --test",
    "lint": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {},
  "peerDependencies": {}
}
```

## `exports` Field (the contract)

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./errors": "./dist/errors.js",
    "./schema": "./dist/schema.js"
  }
}
```

Subpath exports are the public API. Internal files are inaccessible to consumers even if they exist in the repo.

## Platform-Specific Code (Conditional Exports)

```json
{
  "exports": {
    ".": {
      "node": {
        "import": "./dist/node.js",
        "require": "./dist/node.cjs"
      },
      "default": "./dist/browser.js"
    }
  }
}
```

Order: most specific first (`node` + `import`), then `default`. Node.js resolution will pick the first match.

## Workspaces (Monorepo)

```json
// root package.json
{
  "workspaces": ["packages/*"]
}
```

Internal packages referenced as `"@scope/other-pkg": "workspace:*"`. Use `*` to track the workspace, pin a version only at release.

## Catalog (pnpm)

For shared dependency versions across the monorepo, use `pnpm-workspace.yaml`:

```yaml
catalog:
  effect: ^3.10.0
  typescript: ^5.6.0
```

Then `"effect": "catalog:effect"` in any package.

## Internal vs Published

| Internal | Published |
|---|---|
| No `@scope/` name | Real package name |
| `private: true` | No `private` |
| Free cross-imports | Only via API |
| Co-located tests | `test/` |
| No CHANGELOG | CHANGELOG required |

## Common Mistakes

`main` without `exports`; barrel files hiding cycles; importing from `dist/` in tests; missing `"type": "module"`; mixing `import`/`require` without conditional; bundling deps; no `"files"` field; version mismatch.

## Red Flags

Internal files imported from outside (the `exports` field is a lie); tests importing from `dist/`; package size > 200KB (probably bundled deps); no `CHANGELOG.md`; `any` in public types; circular deps between packages; one package doing two things; "internal" package published accidentally.

## Anti-Patterns

**Barrel god** (`index.ts` re-exports 200 things); **dist-importing tests** (slow, broken); **bundled deps** (consumer can't dedupe); **circular packages** (A imports B, B imports A); **monorepo where every file is a package** (overhead kills DX); **"internal" that escaped** (someone `npm publish`-ed the private one).
