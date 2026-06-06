# OpenCode-Style TypeScript Package

## Overview

How to structure, build, and publish TypeScript packages following OpenCode's conventions. This covers the difference between internal packages (source-only, no build) and published packages (compiled to dist), exports maps, conditional imports for platform-specific code, workspace/catalog dependency management, and the file/directory conventions used across 30+ packages in a multi-package monorepo.

This is the "how to set up a package" companion to the `opencode-ts-service` skill (which covers how to organize code within a package).

## When to Use

- Creating a new npm package (public or internal) in a TypeScript project
- Setting up a monorepo with shared packages
- Structuring a package that needs to support multiple runtimes (Bun + Node)
- Publishing a TypeScript library to npm
- Reviewing package.json configuration for correctness

## When NOT to Use

- Single application with no shared packages
- Frontend-only packages that use Vite/Rollup bundling (different export conventions)
- Packages that need CommonJS compatibility (OpenCode is ESM-only)

---

## Part 1: Package Types

OpenCode has three distinct package types:

| Type | Example | `private` | Has Build | Published to npm | Consumers |
|---|---|---|---|---|---|
| **Application** | `packages/opencode` | `true` | No (source-only) | No | Only itself |
| **Internal library** | `packages/core` | `true` | No (source-only) | No | Other workspace packages |
| **Published library** | `packages/sdk/js` | Not set | Yes (tsc -> dist) | Yes (`@opencode-ai/sdk`) | External users |

The critical distinction: **internal packages run from source** (exports point to `./src/*.ts`). Only published packages compile to `dist/`.

---

## Part 2: package.json Conventions

### Every package gets these fields

```json
{
  "$schema": "https://json.schemastore.org/package.json",
  "name": "@scope/package-name",
  "type": "module",
  "license": "MIT",
  "scripts": {
    "typecheck": "bun run tsc --noEmit",
    "test": "bun test"
  }
}
```

The `$schema` field is not optional — it enables IDE autocompletion for package.json. Every single OpenCode package.json has it.

### Internal package (source-only)

```json
{
  "$schema": "https://json.schemastore.org/package.json",
  "name": "@opencode-ai/core",
  "type": "module",
  "license": "MIT",
  "private": true,
  "scripts": {
    "typecheck": "tsgo --noEmit",
    "test": "bun test",
    "test:ci": "mkdir -p .artifacts/unit && bun test --timeout 30000 --reporter=junit --reporter-outfile=.artifacts/unit/junit.xml"
  },
  "exports": {
    "./*": "./src/*.ts"
  },
  "imports": {
    "#platform": {
      "bun": "./src/platform.bun.ts",
      "node": "./src/platform.node.ts",
      "default": "./src/platform.bun.ts"
    }
  }
}
```

Key rules:
- `private: true` — never publish internal packages
- `exports` map with `./* -> ./src/*.ts` — any file in src/ is importable
- No `version` field (internal packages are versioned by the monorepo)
- No `build` script (Bun runs TypeScript natively)
- `imports` for platform-specific code only when needed

### Published library (compiled to dist)

```json
{
  "$schema": "https://json.schemastore.org/package.json",
  "name": "@scope/my-lib",
  "version": "1.0.0",
  "type": "module",
  "license": "MIT",
  "scripts": {
    "typecheck": "tsgo --noEmit",
    "build": "bun ./script/build.ts",
    "test": "bun test"
  },
  "exports": {
    ".": "./src/index.ts",
    "./submodule": "./src/submodule/index.ts"
  },
  "files": [
    "dist"
  ]
}
```

Key differences from internal:
- Has `version` field (for npm publishing)
- No `private: true`
- `exports` points to `./src/*.ts` for development (Bun resolves from source)
- `files: ["dist"]` — only the compiled output is published to npm
- Has a `build` script that runs `bun tsc`

**Important:** The build step compiles to `dist/` but the publish script rewrites the exports to point to `dist/` paths. The `package.json` you ship to npm has different `exports` than the one in your repo. This is handled by your publish script.

### The exports map

OpenCode's `exports` map is the central contract for how consumers import from a package:

```json
{
  "exports": {
    ".": "./src/index.ts",                    // import from "pkg"
    "./client": "./src/client.ts",            // import from "pkg/client"
    "./server": "./src/server.ts",            // import from "pkg/server"
    "./v2": "./src/v2/index.ts",              // subdirectory entry
    "./*": "./src/*.ts"                       // catch-all (internal packages only)
  }
}
```

**Rules:**
- Every entry point is explicit — no accidental `import from "pkg/src/internal/leaky"`
- Internal packages use `./*` for convenience; published packages list every entry
- Entry points map to `.ts` files (Bun) — no `.js` extension confusion
- Subdirectories have their own entry: `./submodule: "./src/submodule/index.ts"`
- No `./dist/` in exports (the publish script transforms these)

---

## Part 3: Conditional Imports (Platform-Specific Code)

OpenCode uses Bun's `imports` field for platform-specific code. This is how they handle Bun vs Node.js differences:

```json
{
  "imports": {
    "#sqlite": {
      "bun": "./src/database/sqlite.bun.ts",
      "node": "./src/database/sqlite.node.ts",
      "default": "./src/database/sqlite.bun.ts"
    },
    "#pty": {
      "bun": "./src/pty/pty.bun.ts",
      "node": "./src/pty/pty.node.ts",
      "default": "./src/pty/pty.bun.ts"
    },
    "#fff": {
      "bun": "./src/filesystem/fff.bun.ts",
      "node": "./src/filesystem/fff.node.ts",
      "default": "./src/filesystem/fff.bun.ts"
    }
  }
}
```

```typescript
// Consumer — clean, no platform branching
import { db } from "#sqlite"
import { spawnPty } from "#pty"
```

**Rules:**
- Each `#import` has a `.bun.ts` and `.node.ts` implementation
- Both exports the same interface
- The bundler/runtime picks the right file based on the condition
- `default` falls back to Bun implementation
- Use this pattern for: database drivers, PTY/terminal, file watching, filesystem operations
- Do NOT use this for business logic — only for platform-API differences

**The interface contract:**

```typescript
// src/database/sqlite.bun.ts
export const db = {
  query: async (sql: string, params: unknown[]) => {
    // Bun's built-in SQLite
  }
}

// src/database/sqlite.node.ts
export const db = {
  query: async (sql: string, params: unknown[]) => {
    // better-sqlite3 or @effect/sql-sqlite-node
  }
}
```

---

## Part 4: TypeScript Configuration

### Internal package (source-only)

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

Key: `noEmit: true` — Bun handles execution, tsc only type-checks.

### Published library (compiled)

```json
// tsconfig.json
{
  "extends": "@tsconfig/node22/tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "declaration": true,
    "composite": true,
    "rootDir": "src",
    "lib": ["es2022", "dom", "dom.iterable"]
  },
  "include": ["src"]
}
```

Key differences:
- `outDir: "dist"` — compiled output goes here
- `declaration: true` — generates `.d.ts` files for consumers
- `composite: true` — enables project references in a monorepo
- `extends: "@tsconfig/node22/tsconfig.json"` — standard Node config base
- No `noEmit` — we WANT tsc to emit files

---

## Part 5: Build Script (Published Packages)

OpenCode's `packages/sdk/js/script/build.ts` is the reference pattern:

```typescript
// script/build.ts
#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

// Step 1: Clean old build
await $`rm -rf dist`

// Step 2: Generate any code (OpenAPI client, etc.)
// await generateClient()

// Step 3: Compile TypeScript
await $`bun tsc`

// Step 4: Format output (optional)
await $`bun prettier --write src/`

// Step 5: Clean up temp files
// await $`rm openapi.json`
```

The build:
1. Cleans `dist/`
2. Runs optional code generation
3. Compiles with `bun tsc` (uses the tsconfig.json)
4. Optionally formats generated output
5. Cleans up temporary artifacts

### The publish script transforms exports

When publishing, the exports map needs to point to `dist/` paths, not `src/` paths. This is handled by the publish script (not shown in OpenCode's repo but the Issue #14364 bug fix reveals the pattern):

```typescript
// script/publish.ts
// Recursively transform export paths:
// "./src/index.ts" -> "./dist/src/index.js"
// "./src/client.ts" -> "./dist/src/client.js"

function transformExports(exports: Record<string, string>, prefix: string) {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(exports)) {
    result[key] = {
      import: value.replace("./src", "./dist").replace(/\.ts$/, ".js"),
      types: value.replace("./src", "./dist").replace(/\.ts$/, ".d.ts"),
    }
  }
  return result
}
```

This transforms the single-string `exports` into dual `{ import, types }` format for npm.

---

## Part 6: Monorepo Setup

OpenCode is a Bun workspace monorepo with catalogs for shared dependency versions.

### Root package.json

```json
{
  "name": "opencode",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.3.10",
  "workspaces": {
    "packages": [
      "packages/*",
      "packages/sdk/js",
      "packages/slack"
    ],
    "catalog": {
      "typescript": "5.8.2",
      "effect": "^3.0.0",
      "@effect/platform": "^0.0.0",
      "zod": "4.1.8",
      "drizzle-orm": "1.0.0-beta.16-ea816b6",
      "remeda": "2.26.0",
      // Pin every shared dependency version here
    }
  }
}
```

### How catalogs work

Bun's `catalog:` protocol lets you define shared dependency versions in the root `package.json` and reference them in every package:

```json
// packages/core/package.json
{
  "dependencies": {
    "effect": "catalog:",       // resolves to "^3.0.0" from root catalog
    "drizzle-orm": "catalog:",  // resolves to the pinned beta version
    "zod": "catalog:"           // resolves to "4.1.8"
  }
}
```

Rules:
- The `catalog:` protocol guarantees all packages use the EXACT same version
- Update one place (root catalog) to update every package
- Pin versions in the catalog (no ranges for critical deps like Effect)
- Override individual packages with `overrides` field if needed

### Workspace dependencies

Internal packages use `"workspace:*"` protocol:

```json
{
  "dependencies": {
    "@opencode-ai/core": "workspace:*",
    "@opencode-ai/sdk": "workspace:*",
    "@opencode-ai/plugin": "workspace:*"
  }
}
```

`workspace:*` means "use whatever version is in the workspace" — no range resolution, always the local copy.

### Scripts at root vs package level

Root scripts should only orchestrate:
```json
{
  "scripts": {
    "dev": "bun run --cwd packages/myapp dev",
    "typecheck": "bun turbo typecheck",
    "test": "echo 'run tests from package directory' && exit 1"
  }
}
```

Use `bun turbo` (or `turbo`) for running typecheck/test across all packages. Each package owns its own dev/build/test commands.

---

## Part 7: Directory Conventions

### Package directory structure

```
packages/
  my-lib/
    src/
      index.ts           # Main entry point
      client.ts          # Sub-entry: client
      server.ts          # Sub-entry: server
      submodule/         # Sub-entry as directory
        index.ts
      internal/          # Private — not exported
        helpers.ts
    script/
      build.ts           # Build script
      publish.ts         # Publish script (transforms exports)
    example/              # Usage example
      basic.ts
    dist/                 # Compiled output (gitignored, published)
    package.json
    tsconfig.json
```

### src/ conventions

Same as the `opencode-ts-service` skill:

- Flat `src/` — no `src/app/`, `src/lib/`, `src/utils/`
- One file per concept
- Subdirectories only for modules that have their own sub-exports
- Favor flat over nested — OpenCode's `packages/core/src/` has 40+ top-level files

### The `script/` directory

Build-time scripts live in `script/`, not in `src/`:
```
script/
  build.ts     # Compilation
  publish.ts   # npm publish with export transformation
  generate.ts  # Code generation (OpenAPI client, etc.)
```

These run at build time, not runtime. They don't contribute to the published package.

---

## Part 8: Naming Conventions

### Package names

- Internal: `@opencode-ai/core`, `@opencode-ai/sdk`
- Scope: `@scope/name` for all packages
- Directory name matches the short package name: `packages/core/` contains `@opencode-ai/core`

### File names

- **Service files**: `kebab-case.ts` — matches the module export name
- **Test files**: `<name>.test.ts` — co-located with source
- **Platform-specific**: `<name>.bun.ts`, `<name>.node.ts` — suffixed by platform
- **SQL schema**: `<name>.sql.ts` — Drizzle convention
- **Env declarations**: `<name>.d.ts` — ambient type declarations

### Entry points

- `index.ts` — always the main entry for a directory module
- `client.ts` / `server.ts` — separate client/server entry points
- `<concept>.ts` — single-file modules at the top level

---

## Part 9: Dependency Management Rules

### What goes where

| Dependency type | `dependencies` | `devDependencies` |
|---|---|---|
| Runtime deps (Effect, Drizzle, Redis) | YES | NO |
| Build tools (TypeScript, esbuild) | NO | YES |
| Test framework (Bun is built-in) | NO | NO |
| Type definitions (@types/*) | NO | YES |
| Platform-specific adapters (@effect/platform-node) | YES | NO |
| Internal workspace packages (@scope/core) | YES (workspace:*) | NO |

### Version protocols

| Scenario | Protocol | Example |
|---|---|---|
| Shared across all packages | `catalog:` | `"effect": "catalog:"` |
| Internal monorepo package | `workspace:*` | `"@scope/core": "workspace:*"` |
| External stable dependency | Exact or pinned minor | `"prettier": "3.6.2"` |
| External fast-moving dependency | ^ range | `"semver": "^7.6.0"` |
| Override a transitive version | `overrides` | `"drizzle-orm": "catalog:"` |
| Apply a patch | `patchedDependencies` | `"pkg@1.0.0": "patches/pkg@1.0.0.patch"` |

### Platform-specific adapters

These live in `dependencies` (not `devDependencies`) because they're needed at runtime:

```json
{
  "dependencies": {
    "@effect/platform-node": "catalog:",
    "@parcel/watcher": "2.5.1"
  }
}
```

Platform-specific native modules (`@parcel/watcher-darwin-arm64`, etc.) go in `devDependencies` — Bun resolves the right binary automatically.

---

## Part 10: Testing Conventions

### Test runner

OpenCode uses **Bun test** (`bun test`) — no Jest, no Vitest.

```bash
# Run all tests in the package
bun test

# Run with timeout (for integration tests)
bun test --timeout 30000

# JUnit output for CI
bun test --timeout 30000 --reporter=junit --reporter-outfile=.artifacts/unit/junit.xml
```

### Test file conventions

- Co-located: `foo.test.ts` next to `foo.ts`
- Test the public interface (Effect services via test layers), not internals
- No `jest.mock()` or `vi.mock()` — use `Layer.succeed` for test doubles

### CI configuration

OpenCode's CI runs:
```bash
# Per-package (usually in parallel via turbo)
bun run typecheck     # tsc --noEmit
bun test              # bun test --timeout 30000
```

---

## Part 11: Full Package Templates

### Template: Internal library package (source-only)

```json
{
  "$schema": "https://json.schemastore.org/package.json",
  "name": "@scope/internal-lib",
  "type": "module",
  "license": "MIT",
  "private": true,
  "scripts": {
    "typecheck": "bun run tsc --noEmit",
    "test": "bun test"
  },
  "exports": {
    "./*": "./src/*.ts"
  },
  "dependencies": {
    "effect": "catalog:"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "@types/bun": "catalog:"
  }
}
```

### Template: Published library package

```json
{
  "$schema": "https://json.schemastore.org/package.json",
  "name": "@scope/public-lib",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "scripts": {
    "typecheck": "bun run tsc --noEmit",
    "build": "bun ./script/build.ts",
    "test": "bun test"
  },
  "exports": {
    ".": "./src/index.ts",
    "./sub": "./src/sub/index.ts"
  },
  "files": [
    "dist"
  ],
  "dependencies": {
    "effect": "catalog:"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "@types/bun": "catalog:"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "outDir": "dist",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "declaration": true,
    "composite": true,
    "rootDir": "src",
    "strict": true,
    "target": "esnext",
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

```typescript
// script/build.ts
#!/usr/bin/env bun
import { fileURLToPath } from "url"
const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)
import { $ } from "bun"

await $`rm -rf dist`
await $`bun tsc`
```

### Template: Application package

```json
{
  "$schema": "https://json.schemastore.org/package.json",
  "name": "@scope/my-app",
  "type": "module",
  "license": "MIT",
  "private": true,
  "scripts": {
    "typecheck": "bun run tsc --noEmit",
    "dev": "bun run --watch src/index.ts",
    "test": "bun test"
  },
  "exports": {
    "./*": "./src/*.ts"
  },
  "imports": {
    "#db": {
      "bun": "./src/storage/db.bun.ts",
      "node": "./src/storage/db.node.ts",
      "default": "./src/storage/db.bun.ts"
    }
  },
  "dependencies": {
    "effect": "catalog:",
    "@effect/platform": "catalog:",
    "@effect/platform-node": "catalog:"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "@types/bun": "catalog:"
  }
}
```

---

## Common Mistakes

| Mistake | Problem | Fix |
|---|---|---|
| No `exports` map | Any file can be imported, breaking semver | Explicit `exports` map listing every public entry point |
| `"main": "./dist/index.js"` without `exports` | Pre-Node 12 pattern, ignores subpath imports | Remove `main`, use `exports` with explicit entries |
| No `files` field on published package | All files published (tests, scripts, tsconfig) | `"files": ["dist"]` |
| Internal package has `version` | Version drift across workspace, confusion | Omit `version` or set `"private": true` |
| Published package missing `version` | npm publish fails | Always set `version` |
| Barrel `index.ts` in multi-sibling dirs | Forces eager eval of all siblings, defeats tree-shaking | Import individual files |
| Conditional imports for business logic | Platform branching leaks into domain code | Use platform code only for API adapters (DB, FS, PTY) |
| `devDependencies` vs `dependencies` confusion | Runtime deps missing for consumers | Runtime = dependencies, build-time = devDependencies |
| No `$schema` in package.json | No IDE autocompletion | Always include `"$schema": "https://json.schemastore.org/package.json"` |
| Hardcoding version in every package | Upgrade requires touching N files | Use `catalog:` protocol for shared deps |
| Multiple TypeScript versions | Type mismatch across packages | Pin TypeScript in root catalog |

## Red Flags — STOP and Fix

- No `exports` map — Any consumer can import internal files. Add one.
- No `files` filter on a published package — Publishing your tests and tsconfig. Add `"files": ["dist"]`.
- Source files in `dist/` — Your tsc output doesn't match exports. Fix tsconfig `outDir` or rewrite exports.
- `index.ts` barrel in a multi-module directory — Every import loads everything. Remove it.
- Conditional `#imports` for domain logic — Platform branching belongs in adapters, not services.
- `"main": "./index.js"` without `exports` — Use the modern exports map, not the legacy main field.

## Quick Reference

### Package type decision tree

```
Starting a new package?
├─ Will it be published to npm?
│  ├─ YES → Published library template (tsconfig with outDir, build script, files: [dist])
│  └─ NO  → Is it shared between apps?
│     ├─ YES → Internal library template (private: true, source-only)
│     └─ NO  → Application template (private: true, imports for platform code)
```

### package.json checklist

- [ ] `$schema` field present
- [ ] `name: "@scope/package"`
- [ ] `type: "module"`
- [ ] `private: true` for internal packages
- [ ] `version` for published packages
- [ ] `exports` map with all public entry points (no leaks)
- [ ] `files: ["dist"]` for published packages
- [ ] `imports` for platform-specific code (if needed)
- [ ] `scripts.typecheck` present
- [ ] `scripts.test` present
- [ ] Dependencies use `catalog:`, `workspace:*`, or pinned versions
- [ ] Runtime deps in `dependencies`, build deps in `devDependencies`
