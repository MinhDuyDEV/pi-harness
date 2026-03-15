# Tilth Usage Patterns

## Search-First Exploration

Always search before reading. One search replaces multiple grep → read → grep cycles.

```
# Bad: 6 tool calls
glob("src/**/*.ts") → read("src/auth.ts") → "too big" → grep("handleAuth") → read again

# Good: 1 tool call
tilth_search(query: "handleAuth", scope: "src/")
→ definitions + usages + expanded source + callees in one response
```

## Definition vs Usage

Symbol search returns matches tagged as `[definition]` or `[usage]`:
- **Definition**: Where the symbol is declared (function, class, struct, etc.)
- **Usage**: Where it's referenced/called
- **Impl**: Where a trait/interface is implemented

Definitions are ranked first and expanded by default.

## Callee Footer

Expanded definitions include a `── calls ──` footer showing resolved callees:

```
── calls ──
  validateToken  src/auth.ts:24-42  fn validateToken(token: string): Claims | null
  refreshSession  src/auth.ts:91-120  fn refreshSession(req, res)
```

Follow call chains without separate searches for each callee.

## Sibling Footer

When a definition is inside a class/struct, expanded output includes `── siblings ──`:

```
── siblings ──
  authenticate  src/auth.ts:99-130  fn authenticate(credentials)
  authorize  src/auth.ts:132-180  fn authorize(user, resource)
```

## Context Boosting

Pass `context` parameter to boost results near the file you're editing:

```
tilth_search(query: "resolveConfig", context: "src/config/loader.ts")
```

Matches in the same directory/package rank higher.

## Session Dedup

In MCP mode, previously expanded definitions show `[shown earlier]` instead of full body.
This saves tokens when the agent revisits symbols it already saw.

## Faceted Results (>5 matches)

When there are many matches, results are grouped:

1. **Definitions** — where the symbol is declared
2. **Implementations** — trait/interface impls
3. **Tests** — compact one-line-per-match format
4. **Usages — same package** — nearby usages
5. **Usages — other** — cross-package usages

## Outline Drill-Down

Large file outlined → use section to get exact lines:

```
# Step 1: See the shape
tilth_read(path: "src/server.rs")
→ [45-120]  fn handle_request(req: Request) -> Response

# Step 2: Get the code
tilth_read(path: "src/server.rs", section: "45-120")
→ Full source with line numbers
```

## Batch Reading

Read multiple files in one call:

```
tilth_read(paths: ["src/auth.ts", "src/config.ts", "src/routes.ts"])
```

Each file gets independent smart handling. Max 20 files per batch.

## Callers Query

Find all call sites of a symbol using structural tree-sitter matching:

```
tilth_search(query: "isTrustedProxy", kind: "callers")
→ Shows each call site with surrounding function context
```

## Content Search

Find literal text (not symbol names):

```
tilth_search(query: "TODO: fix", kind: "content")
```

## Regex Search

```
tilth_search(query: "handle[A-Z]\\w+", kind: "regex")
```

## Anti-Patterns

- **Don't re-read expanded results** — search output already contains the source
- **Don't use scope for cwd** — omit scope entirely to search current directory
- **Don't skip tilth_deps before breaking changes** — blast radius matters
- **Don't use grep/cat/find** — tilth tools are always better for code
