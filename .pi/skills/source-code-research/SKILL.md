---
name: source-code-research
description: "Use when researching library implementation details beyond API docs. Fetches package source code using opensrc to understand internals, edge cases, and implementation patterns. Complements documentation-based research with actual code inspection."
version: 1.0.0
tags: [research, code-quality]
dependencies: [opensrc]
---

# Source Code Research - Deep Library Investigation

Fetch and analyze package source code when documentation is insufficient.

## When to Use

- Documentation gaps — API docs don't explain behavior clearly
- Edge cases — need to understand how library handles corner cases
- Implementation details — need to see actual code, not just interfaces
- Debugging — library behaving unexpectedly, need to trace internals
- Evaluation — deciding if library fits requirements, need to assess quality
- Type definitions — TypeScript types exist but implementation unclear

## When NOT to Use

- Official docs answer your question (check Context7 first)
- You only need API syntax (codesearch is faster)
- Library is too large to analyze in session (>50k LOC)

## Prerequisites

OpenSrc must be available:

```bash
npx opensrc --help
```

If not installed, it will be fetched via npx automatically.

## Workflow

### Step 1: Identify What to Fetch

Determine the minimal package/repo needed:

```typescript
// If researching a specific npm package
const target = "zod"; // Just the package name

// If researching Python library
const target = "pypi:requests";

// If researching Rust crate
const target = "crates:serde";

// If researching GitHub repo directly
const target = "vercel/ai"; // or "github:vercel/ai@v3.0.0"
```

### Step 2: Fetch Source Code

Run opensrc to clone the repository:

```bash
npx opensrc <package>
```

**Examples:**

```bash
npx opensrc zod                    # Fetch latest zod from npm
npx opensrc zod@3.22.0             # Fetch specific version
npx opensrc pypi:requests          # Fetch Python package
npx opensrc vercel/ai              # Fetch GitHub repo
npx opensrc vercel/ai@v3.0.0       # Fetch specific tag
```

**What happens:**

- Clones source to `opensrc/repos/<host>/<owner>/<repo>/`
- Auto-detects version from lockfiles if no version specified
- Updates `opensrc/sources.json` with metadata
- Adds `opensrc/` to `.gitignore` automatically (asks once)

### Step 3: Locate Relevant Code

Use search tools to find code you need:

```typescript
// Find all TypeScript source files
glob({ pattern: "opensrc/**/src/**/*.ts" });

// Search for specific function/class
grep({
  pattern: "class ValidationError",
  path: "opensrc/",
  include: "*.ts",
});

// Search for function pattern
grep({
  pattern: "export function parse",
  path: "opensrc/",
  include: "*.ts",
});
```

### Step 4: Read and Analyze

Read the implementation:

```typescript
// Read the file
read({ filePath: "opensrc/repos/github.com/colinhacks/zod/src/types.ts" });

// Use LSP for navigation (if available)
lsp_lsp_goto_definition({
  filePath: "opensrc/.../file.ts",
  line: 42,
  character: 10,
});

// Find all references
lsp_lsp_find_references({
  filePath: "opensrc/.../file.ts",
  line: 42,
  character: 10,
});
```

### Step 5: Document Findings

Write research findings to bead artifact:

````markdown
# Research: [Library Name] Implementation

**Package:** [name@version]
**Source:** opensrc/repos/[path]
**Focus:** [What you were investigating]

## Key Findings

### [Topic 1]: [Function/Pattern Name]

**Location:** `opensrc/repos/.../file.ts:42`

**Implementation:**

```typescript
// Paste relevant code snippet
```
````

**Insights:**

- [What you learned]
- [Edge cases discovered]
- [Performance implications]

**Confidence:** High (direct source code)

---

### [Topic 2]: [Another Discovery]

[Same structure]

## Answers to Original Questions

1. **Q:** [Original question]
   **A:** [Answer based on source code]
   **Evidence:** `file.ts:123-145`

2. **Q:** [Another question]
   **A:** [Answer]

## Recommendations

Based on source analysis:

- [Recommendation 1]
- [Recommendation 2]

## Caveats

- Version analyzed: [version]
- Code may have changed in newer versions
- Private APIs discovered may change without notice

````

## Limitations

### When Source Code Won't Help

- **Build-time transforms**: Source may differ from runtime (Babel, webpack)
- **Native modules**: C/C++ code requires different analysis
- **Minified code**: Some packages don't publish source
- **Monorepos**: May need to navigate complex structure

### Alternatives

If opensrc doesn't work:

1. **GitHub web interface**: Browse online at github.com/owner/repo
2. **npm unpacked**: `npm pack <package>` then extract
3. **node_modules**: If already installed, check `node_modules/<package>/`
4. **Source maps**: If debugging, browser DevTools may show original source

## Integration with Other Research Methods

Source code research complements other tools:

| Method         | Best For                   | Source Code Adds               |
| -------------- | -------------------------- | ------------------------------ |
| **Context7**   | API docs, official guides  | Implementation details         |
| **codesearch** | Usage patterns in the wild | Canonical implementation       |
| **grepsearch** | Real-world examples        | How library itself works       |
| **Web search** | Tutorials, blog posts      | Ground truth from source       |
| **Codebase**   | Project-specific patterns  | How dependencies actually work |

**Recommended flow:**

1. Context7 - Check official docs
2. Codebase - Check existing usage
3. **Source code** - If still unclear, fetch source
4. codesearch/grepsearch - See how others use it
5. Web search - Last resort for context

## Cleanup

After research is complete:

```bash
# Remove specific package
npx opensrc remove <package>

# Remove all sources
npx opensrc clean

# Remove just npm packages
npx opensrc clean --npm

# Keep sources for documentation
# (opensrc/ is gitignored, won't be committed)
```

## Success Criteria

You've successfully used this skill when:

- [ ] Fetched correct package/version source
- [ ] Located relevant implementation code
- [ ] Understood behavior from reading source
- [ ] Documented findings with file:line references
- [ ] Answered original research question with high confidence
- [ ] Provided code evidence for claims

## Quick Reference

```bash
# Fetch package source
npx opensrc <package>                    # npm (auto-detect version)
npx opensrc <package>@<version>          # npm (specific version)
npx opensrc pypi:<package>               # Python
npx opensrc crates:<package>             # Rust
npx opensrc <owner>/<repo>               # GitHub
npx opensrc <owner>/<repo>@<tag>         # GitHub (specific tag)

# List fetched sources
npx opensrc list
npx opensrc list --json

# Remove sources
npx opensrc remove <package>
npx opensrc clean
npx opensrc clean --npm --pypi --crates

# Source location
opensrc/repos/<host>/<owner>/<repo>/

# Metadata
opensrc/sources.json
```

## References

- `references/common-patterns.md` - Error handling, tracing behavior, quality evaluation patterns
- `references/source-structure.md` - npm/PyPI/Rust source layouts
- `references/analysis-tips.md` - Tests, examples, changelog, types, blame
- `references/example-workflow.md` - Full zod async refinement workflow
- `references/anti-patterns.md` - What not to do when researching
- `references/further-reading.md` - External links
````
