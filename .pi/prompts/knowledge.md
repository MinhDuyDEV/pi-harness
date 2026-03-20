---
description: Export memory observations to project KNOWLEDGE.md (append-only flat-file layer)
argument-hint: "[bead-id] [--limit 50]"
---

# Knowledge: $ARGUMENTS

Export memory observations from the memory tools into a human-readable `KNOWLEDGE.md` in project root.

> This is the flat-file layer on top of the memory database.
> Always append. Never overwrite previous exports.

## Load Skills

```typescript
skill({ name: "memory-system" });
```

## Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `[bead-id]` | none | If provided, export only observations for this bead |
| `--limit <n>` | `50` | Maximum observations to export (most recent first) |

Set:

- `BEAD_FILTER = [bead-id]` (optional)
- `LIMIT = --limit or 50`
- `OUTPUT_FILE = KNOWLEDGE.md`

---

## Phase 1: Pull Observations from Memory Tools

Use `memory-search` + `memory-get` only (no direct DB access, no raw SQL, no shell DB CLI usage).

### 1.1 Required grouping types

Query and group only these types:

1. `decision` → **Decisions**
2. `pattern` → **Patterns**
3. `learning` → **Learnings**
4. `warning` → **Warnings**
5. `bugfix` → **Bugfixes**

Ignore other types unless you explicitly add an **Other** section.

### 1.2 Search by type, then hydrate full observations

For each required type, run `memory-search` and collect IDs.

```typescript
const TYPES = ["decision", "pattern", "learning", "warning", "bugfix"] as const;
const idsByType: Record<string, number[]> = {};

for (const t of TYPES) {
  const searchResults = await memory-search({
    query: "*",
    type: t,
    limit: LIMIT,
  });

  idsByType[t] = (searchResults || [])
    .map((r) => Number(r.id))
    .filter((id) => Number.isFinite(id));
}
```

Then fetch full details via `memory-get` (comma-separated IDs).

```typescript
const allIds = [...new Set(Object.values(idsByType).flat())];
const memoryGetResult = allIds.length
  ? await memory-get({ ids: allIds.join(",") })
  : [];

const fullObservations = Array.isArray(memoryGetResult)
  ? memoryGetResult
  : (memoryGetResult?.observations ?? []);
```

### 1.3 Filter in prompt logic (including bead filter)

Filter observations in prompt logic (not SQL, and not via query-string filtering). Never interpolate `BEAD_FILTER` into shell commands or SQL.

```typescript
const observations = fullObservations.filter((obs) => {
  if (!TYPES.includes(obs.type)) return false;
  if (BEAD_FILTER && String(obs.bead_id ?? "") !== String(BEAD_FILTER)) return false;
  return true;
});
```

After dedupe (Phase 3), regroup observations by type, preserve recency order (`created_at` descending), and apply `LIMIT` as the max per type.

---

## Phase 2: Render Human-Readable Markdown Block

Build one export block in this shape:

```markdown
## Knowledge Export — YYYY-MM-DD
- Scope: [project-wide | bead <id>]
- Source: memory tools (`memory-search` + `memory-get`)
- Count: <N>

### Decisions
#### #<id> — <title>
- Date: <YYYY-MM-DD>
- Bead: <bead-id or n/a>
- Confidence: <high|medium|low>

<narrative or facts>

### Patterns
#### #<id> — <title>
- Date: <YYYY-MM-DD>
- Bead: <bead-id or n/a>
- Confidence: <high|medium|low>

<narrative or facts>

### Learnings
#### #<id> — <title>
- Date: <YYYY-MM-DD>
- Bead: <bead-id or n/a>
- Confidence: <high|medium|low>

<narrative or facts>

### Warnings
#### #<id> — <title>
- Date: <YYYY-MM-DD>
- Bead: <bead-id or n/a>
- Confidence: <high|medium|low>

<narrative or facts>

### Bugfixes
#### #<id> — <title>
- Date: <YYYY-MM-DD>
- Bead: <bead-id or n/a>
- Confidence: <high|medium|low>

<narrative or facts>
```

Formatting rules:

- Keep it simple and readable (short headers + bullet metadata)
- Section headers are `###`; observation entries under them are `####`
- For each entry, include **Date**, **Bead**, **Confidence**
- Use `narrative`; if empty, fall back to `facts`
- Preserve recency order inside each section

If zero observations found (or all matches were skipped by dedupe), still append a small block documenting the run:

```markdown
## Knowledge Export — YYYY-MM-DD
- Scope: ...
- Source: memory tools (`memory-search` + `memory-get`)
- Count: 0

_No matching observations found._
```

---

## Phase 3: Deduplicate + Append to `KNOWLEDGE.md` (Never Overwrite)

Initialize file once if missing:

```bash
[ -f KNOWLEDGE.md ] || cat <<'EOF' > KNOWLEDGE.md
# KNOWLEDGE

Human-readable exports from the memory system.
Append-only history.
EOF
```

Before rendering final sections, deduplicate against existing exports:

```typescript
const existingContent = await fs.readFile("KNOWLEDGE.md", "utf8");
const existingIds = new Set(
  [...existingContent.matchAll(/(?:^|\s)#(\d+)\b/gm)].map((m) => Number(m[1]))
);

const dedupedObservations = observations.filter((obs) => !existingIds.has(obs.id));

const dedupedGrouped = Object.fromEntries(TYPES.map((t) => [t, [] as typeof dedupedObservations]));
for (const obs of dedupedObservations) dedupedGrouped[obs.type].push(obs);
for (const t of TYPES) {
  dedupedGrouped[t] = dedupedGrouped[t]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, LIMIT);
}
```

Rules:

- If `KNOWLEDGE.md` already contains `#<id>`, skip that observation.
- Build section entries from `dedupedGrouped` and total/per-section counts from deduped data only.
- If all candidates were skipped by dedupe, append a block with `Count: 0` and note that all matches already existed.

Append new block:

```bash
cat <<'EOF' >> KNOWLEDGE.md

[PASTE RENDERED EXPORT BLOCK]

EOF
```

---

## Phase 4: Verify + Report

```bash
test -s KNOWLEDGE.md
tail -n 120 KNOWLEDGE.md
```

Report:

- scope used (`project-wide` or `bead <id>`)
- number exported total
- per-section counts (Decisions/Patterns/Learnings/Warnings/Bugfixes)
- file path: `KNOWLEDGE.md`
