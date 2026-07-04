---
name: aislop
version: 1.0.0
description: "Use when checking for AI-generated code slop — narrative comments, swallowed exceptions, console.log leftovers, as any casts, thin wrappers, generic naming, and other patterns AI coding agents leave behind"
---

# AI Slop Detection

## Iron Laws

- **Slop is not an opinion.** "This comment is unhelpful" is preference. "This comment restates the code" is fact.
- **Narrative comments** — "Let me think about this…", "Now I'll check…", "The user is asking…". Remove them.
- **Swallowed exceptions** — `catch(e) {}` or `catch(e) { console.error(e) }` with no handling. Surface them.
- **`console.log` leftovers** — Debug output in production code. Delete them.
- **`as any` casts** — "Just to unblock" translates to "permanently untyped". Flag them.
- **Thin wrappers** — `callApi = () => api.call()` with no transformation. Remove them.
- **Generic names** — `helper`, `util`, `manager`, `service` — the name tells you nothing. Rename them.

## When to Use

Code review after AI generation; checking a PR for AI tells; before merge; "this looks like AI wrote it" review; code-cleanup target identification.

## When NOT to Use

The code is handwritten; the slop is already cleaned up; one-line change that's obviously correct.

## The Slop Checklist

- [ ] Comments that narrate ("Let me think", "First I'll", "Now I'll")
- [ ] `console.log` / `print` / `console.warn` in production code
- [ ] `catch` with empty body or only logging
- [ ] `as any` or `as unknown as T` casts
- [ ] Wrapper that does no transformation
- [ ] `helper` / `util` / `manager` names
- [ ] Dead code (exported but unused)
- [ ] `TODO:` without owner or date
- [ ] Duplicate code blocks (copy-paste)
- [ ] Imported but unused
- [ ] AI-shaped comments ("Let me add validation here")

## Defense

- Read the diff, not just the final file.
- Check for narrative. Agents narrate; humans don't.
- Run `rg 'console\.(log|warn|error)' --type ts` before commit.
- Run `npx fallow dead --format json` before merge.
- Don't approximate — each slop finding is a yes/no.

## Common Mistakes

Calling structural issues "slop" (it's design, use a different skill); opinion masquerading as slop check ("I don't like this" is not slop); flagging AI comments in private code (the user wrote them); "I'll clean it up later" (clean now); missing `as any` because it's in a deep file; missing `console.log` because it's in a test.

## Red Flags

"Let me think about this" comment; `catch (e) {}`; `as any`; wrapper that does nothing; `helper.ts`; `console.log` left; dead code; TODO without owner; copy-paste block; unused import; "I'll clean later".

## Anti-Patterns

**Opinions as slop** ("I don't like"); **narrative in private code**; **"clean later"**; **miss `as any`**; **miss `console.log`**; **call design "slop"** (use code-review skill).
