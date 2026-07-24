# Themes

Pi TUI color palettes for the pi-harness workspace.

## Canonical themes

| Theme | Notes |
|-------|-------|
| `catppuccin.json` | Warm, low-contrast pastels. Default for most users. |
| `tokyo-night.json` | Cool blues and purples, higher contrast. |

Both ship with full `colors` and `export` blocks. Edit one to fork it.

## Local themes

Add new themes as `dark.json`, `amber.json`, `nord.json`, etc. inside this
directory. New files are ignored by git (see `.gitignore`), so they're
local-only and won't be committed. The two canonical themes above are
the only ones versioned in the repo.

## Schema

Each theme JSON has three top-level fields:

- `$schema` — optional JSON Schema URL for editor validation
- `colors` — TUI shell color tokens (pageBg, cardBg, infoBg, text, border,
  toolTitle, toolPending{,Bg,2}, toolSuccess{,Bg,2}, toolError{,Bg,2},
  …). Required for the Pi TUI to pick it up.
- `export` — additional colors for non-TUI surfaces (web, README images,
  rendered diagrams). Optional.

A minimal theme is just `colors` — everything else is optional.

## Validation

After editing a theme, run:

```bash
node scripts/validate-themes.mjs   # (not yet written)
```

For now, manually check that required tokens are present and that the
JSON parses with `jq . .pi/themes/<name>.json`.

## Adding a new theme

1. Copy `catppuccin.json` to a new file in this directory.
2. Edit the `colors` block to taste.
3. Add it to your local config (`.pi/settings.json` → `theme: <name>`).
4. Don't commit it — keep themes local.
