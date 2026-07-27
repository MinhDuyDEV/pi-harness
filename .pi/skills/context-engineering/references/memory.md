# Durable project memory

Durable project knowledge lives in `<cwd>/.pi/MEMORY.md` when the project
chooses to maintain one. It is user-owned state, not a substitute for source
code, `AGENTS.md`, a task plan, or ephemeral scratch notes.

## When to read

Read it before a task that involves architecture or design decisions, prior
work, “before/last time”, a durable learning, or any project that already has
`.pi/MEMORY.md`. Skip it for a trivial isolated edit with no project context.

```bash
test -f .pi/MEMORY.md && rg -n "architecture|decision|pattern|gotcha|<topic>" .pi/MEMORY.md
```

## How to write

Before appending, search for duplicates. Add one concise, grep-friendly bullet
with a type tag such as `[decision]`, `[bugfix]`, `[pattern]`, `[discovery]`,
`[warning]`, or `[learning]`. Record why the decision matters, not a transcript
of the session. Keep the file under roughly 5KB; compact old, low-signal entries
when it grows beyond that.

Do not put project rules in memory (`AGENTS.md` owns those), task progress in
memory (`TODO.md`/`PROGRESS.md` own that), or secrets/tokens in memory. Memory
is loaded on demand by `context-engineering`; it is not automatically injected
into every prompt.

