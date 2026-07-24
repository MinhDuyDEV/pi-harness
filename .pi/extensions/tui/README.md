# pikit-tui

EXTENSION STATUS: **PRIVATE API DEPENDENCY** (see below).

## Purpose

Extends Pi's TUI with:
- **Sidebar**: Session label, model selector, token usage, workspace info, git status, TODO/queue items.
- **Fixed-editor mode**: Pins the editor to a fixed height with integrated terminal scroll, compositor-based
  rendering, and input routing. Replaces the default scrollback-based TUI layout with a split
  scrollable-editor + fixed-bottom-cluster design.
- **Footer capture**: Provides state tracking for the TUI footer (token counts, cost, model info).

## Private API dependency

This extension depends on **Pi's internal, undocumented TUI runtime APIs** that are not covered
by semantic versioning or public API contracts. Specifically:

| Module | Private API | Used for |
|--------|------------|----------|
| `@earendil-works/pi-tui` | `TUI.children`, `TUI.render`, `TUI.doRender` | Render tree traversal and fixed-mode compositing |
| `@earendil-works/pi-tui` | `Terminal.write`, `Terminal.rows` | Terminal patching and scroll region management |
| `@earendil-works/pi-tui` | `children`, `findContainerWithChild` / container naming | Finding containers in Pi's render tree |
| `@earendil-works/pi-coding-agent` | `Theme.fg()` with internal color keys | Theme-consistent sidebar styling |

**These internals are unstable.** A Pi version bump, especially a non-patch release, may silently
break the extension. No deprecation notice will be issued for these internal APIs.

## Supported Pi version

| Package | Version |
|---------|---------|
| `@earendil-works/pi-coding-agent` | `0.81.1` |
| `@earendil-works/pi-tui` | `0.81.1` |

This extension was developed and tested against **Pi v0.81.1**. Internal TUI APIs remain version-sensitive; run the extension typecheck and TUI tests after every Pi upgrade.
The render-tree sibling indices used by `syncFixedRenderables` assume the TUI layout:

```
[status, queue, widget(prompt/input), editor, widget(output), footer]
```

If a future Pi version changes this layout, the `syncFixedRenderables` validation will detect the
incompatibility, loudly disable fixed mode, and log the reason to stderr.

## Development

### Prerequisites

- Pi v0.81.1 (or compatible)
- Node.js >= 22.19.0 with the repository dev dependencies

### Running tests

```bash
# All TUI extension tests (sidebar, footer, fixed-editor)
npm run test:tui

# Individual test files
node --import tsx --test .pi/extensions/tui/tests/sidebar.test.ts
node --import tsx --test .pi/extensions/tui/tests/footer.test.ts
node --import tsx --test .pi/extensions/tui/tests/fixed-editor.test.ts
```

> **Note**: Files under `.pi/extensions/tui/tests/` prefixed with `fixed-editor-settings` or
> `compositor-load` are pre-existing and may fail outside their specific runtime context.
> They are excluded from the core `test:tui` command.

### Design constraints

- **Do not rely on Pi public API docs for internal TUI behavior** — always verify against the
  actual Pi runtime source when making structural changes.
- **Render-tree validation** validates the fixed-mode component tree — the editor container is the
  only required node; optional containers (status, queue, widget, footer) are accessed individually
  when present (see `syncFixedRenderables` in `index.ts`).
- **Compositor error handling** ensures that if `FixedEditorCompositor.install()` fails,
  all terminal/TUI method patches are restored and the error is re-thrown for the caller to handle.
