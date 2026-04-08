---
name: opensrc
description: Use when you need to understand how a library works internally, debug dependency issues, or inspect package source code beyond types and docs. Fetches source for npm, PyPI, crates.io packages and GitHub repos. Includes structured research workflow for deep investigation.
version: 1.1.0
tags: [research, integration, source-code]
dependencies: []
---

# opensrc

Fetch and inspect dependency source code, then run a structured research workflow to answer implementation-level questions with evidence.

## When to Use

- Need to understand how a library/package works internally (not just its interface)
- Debugging issues where types or docs are insufficient
- Exploring implementation patterns in dependencies
- Investigating edge cases and behavior not documented officially
- Evaluating dependency quality before adoption

## When NOT to Use

- Official docs already answer the question (check Context7 first)
- You only need public API syntax or quick examples
- The target is your own codebase (use project search/LSP tools)

## Quick Start

```bash
# Install globally or use npx
npm install -g opensrc

# Fetch npm package (auto-detects installed version from lockfile)
npx opensrc zod

# Fetch from other registries
npx opensrc pypi:requests       # Python/PyPI
npx opensrc crates:serde        # Rust/crates.io

# Fetch GitHub repo directly
npx opensrc vercel/ai           # owner/repo shorthand
npx opensrc github:owner/repo   # explicit prefix
npx opensrc https://github.com/colinhacks/zod  # full URL

# Fetch specific version/ref
npx opensrc zod@3.22.0
npx opensrc owner/repo@v1.0.0
```

## Commands

| Command                 | Description                     |
| ----------------------- | ------------------------------- |
| `opensrc <packages...>` | Fetch source for packages/repos |
| `opensrc list`          | List all fetched sources        |
| `opensrc remove <name>` | Remove specific source          |
| `opensrc clean`         | Remove all sources              |

## Output Structure

After fetching, sources are stored in `opensrc/`:

```
opensrc/
├── settings.json           # User preferences
├── sources.json            # Index of fetched packages/repos
└── repos/
    └── github.com/
        └── owner/
            └── repo/       # Cloned source code
```

## File Modifications

On first run, opensrc may prompt to modify:

- `.gitignore` - adds `opensrc/` to ignore list
- `tsconfig.json` - excludes `opensrc/` from compilation
- `AGENTS.md` - adds section pointing agents to source code

Use `--modify` or `--modify=false` to control this behavior.

## Key Behaviors

1. **Version Detection** - For npm, auto-detects installed version from `node_modules`, `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock`
2. **Repository Resolution** - Resolves package to its git repo via registry API, clones at matching tag
3. **Monorepo Support** - Handles packages in monorepos via `repository.directory`
4. **Shallow Clone** - Uses `--depth 1` for efficient cloning, removes `.git` after clone
5. **Tag Fallback** - Tries `v{version}`, `{version}`, then default branch if tag not found

## Research Workflow (Structured)

Use this 5-step workflow for deep investigations.

### Step 1: Identify

Define the smallest useful target and scope:

- Package/repo name and version
- Specific question (e.g., retry behavior, parsing path, cache invalidation)
- Candidate symbols/files to inspect first

```bash
# Good: scoped target with version
npx opensrc zod@3.22.0

# Also valid
npx opensrc pypi:requests
npx opensrc crates:serde
npx opensrc vercel/ai@v3.0.0
```

### Step 2: Fetch

Fetch source with opensrc and confirm location:

```bash
npx opensrc <target>
npx opensrc list
```

Expected result:

- Source cloned into `opensrc/repos/<host>/<owner>/<repo>/`
- Metadata recorded in `opensrc/sources.json`

### Step 3: Locate

Find relevant files/symbols before deep reading:

- Search by exported symbol names, error classes, feature flags, config keys
- Prefer implementation files over declaration/type-only files
- Include tests/examples to infer intended behavior

Suggested search sequence:

1. Entry points (`index`, `main`, package exports)
2. Core implementation modules
3. Tests and fixtures
4. Changelog/release notes for behavioral changes

### Step 4: Analyze

Read code paths end-to-end and collect evidence:

- Trace function call flow from public API to internal logic
- Note edge-case guards, fallbacks, and error paths
- Distinguish public API from private/internal contracts
- Record exact file:line evidence for each claim

Evidence standard:

- Prefer direct source snippets + `file:line`
- Mark uncertain conclusions explicitly
- Avoid claims based only on docs/types when source contradicts them

### Step 5: Document

Write findings in a reusable format:

```markdown
# Research: <library>

- Package/Version: <name@version>
- Source Path: opensrc/repos/<host>/<owner>/<repo>
- Research Question: <question>

## Findings
1. <claim>
   - Evidence: `path/to/file.ts:42-68`
   - Confidence: High | Medium | Low

## Answer
- <direct answer to original question>

## Caveats
- Version-specific behavior and limits
```

## Integration with Other Research Methods

Use source inspection as part of a layered approach:

| Method         | Best For                   | Source Code Adds               |
| -------------- | -------------------------- | ------------------------------ |
| **Context7**   | API docs, official guides  | Implementation details         |
| **codesearch** | Usage patterns in the wild | Canonical implementation       |
| **grepsearch** | Real-world examples        | How library itself works       |
| **Web search** | Tutorials, blog posts      | Ground truth from source       |
| **Codebase**   | Project-specific patterns  | How dependencies actually work |

Recommended order:

1. Context7 (official docs)
2. Local codebase usage
3. **opensrc source inspection**
4. codesearch/grepsearch external usage patterns
5. Web search for supplementary context

## Limitations

### When Source Code May Not Fully Explain Runtime Behavior

- **Build-time transforms**: transpilation/macros/plugins can alter runtime shape
- **Native modules**: C/C++/Rust bindings require native-level inspection
- **Generated/minified artifacts**: published package may omit readable source
- **Monorepo indirection**: behavior may span multiple internal packages
- **Environment-specific paths**: Node/browser/edge branches can diverge

### Practical Alternatives

If opensrc is incomplete or blocked:

1. Browse repository directly on GitHub
2. Use `npm pack <package>` and inspect tarball contents
3. Inspect installed `node_modules/<package>/` output
4. Use source maps during runtime debugging when available

## Common Workflows

### Fetching a Package

```bash
# Understand zod implementation
npx opensrc zod
# → detects version from lockfile
# → resolves registry metadata
# → clones matching tag/revision
```

### Updating Sources

```bash
# Re-run to refresh against current installed version
npx opensrc zod
```

### Multiple Sources

```bash
npx opensrc react react-dom next
npx opensrc zod pypi:pydantic vercel/ai
```

### Cleanup

```bash
# Remove one source
npx opensrc remove <package>

# Remove all sources
npx opensrc clean

# Remove by ecosystem
npx opensrc clean --npm --pypi --crates
```

## Success Criteria

You are done when all are true:

- [ ] Fetched the correct package/repo and version
- [ ] Located the exact implementation path relevant to the question
- [ ] Verified behavior by reading source (not only types/docs)
- [ ] Captured file:line evidence for major claims
- [ ] Answered the original question with explicit confidence
- [ ] Documented caveats (version bounds, private API risks)

## References

Core opensrc references:

- [CLI Usage & Options](references/cli-usage.md) - Full command reference
- [Architecture](references/architecture.md) - Code structure and extension
- [Registry Support](references/registry-support.md) - npm, PyPI, crates.io details

Research workflow references (merged from source-code-research):

- [Common Patterns](references/common-patterns.md) - Error handling, tracing behavior, quality evaluation patterns
- [Source Structure](references/source-structure.md) - npm/PyPI/Rust source layouts
- [Analysis Tips](references/analysis-tips.md) - Tests, examples, changelog, types, blame
- [Example Workflow](references/example-workflow.md) - End-to-end library investigation example
- [Anti-Patterns](references/anti-patterns.md) - What not to do when researching
- [Further Reading](references/further-reading.md) - External links and complementary resources
