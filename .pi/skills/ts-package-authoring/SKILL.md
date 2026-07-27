---
name: ts-package-authoring
description: >-
  TypeScript npm package authoring — package.json exports as the API contract, conditional/platform
  exports, internal vs published packages, and workspace/catalog dependency management. User-invoked:
  load via /skill:ts-package-authoring when creating a package or modifying package.json in a
  TypeScript monorepo.
metadata:
  version: 1.0.0
disable-model-invocation: true
---

# TypeScript Package Authoring

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

## Red Flags

`main` without `exports`; internal files importable from outside (the `exports` field is a lie); barrel god (`index.ts` re-exports 200 things, hides cycles); tests importing from `dist/` (slow, broken); missing `"type": "module"`; mixing `import`/`require` without conditional exports; bundled deps (consumer can't dedupe — package > 200KB is a tell); no `"files"` field; no `CHANGELOG.md` on a published package; `any` in public types; circular deps between packages (A imports B, B imports A); one package doing two things; monorepo where every file is a package (overhead kills DX); "internal" package published accidentally.
