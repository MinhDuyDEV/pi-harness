# Themes

This directory contains custom TUI themes for Pi.

## Format

Themes are JSON files that define colors for the terminal UI:

```json
{
  "name": "my-theme",
  "colors": {
    "text": "#e0e0e0",
    "bg": "#1a1a2e",
    "accent": "#7c3aed",
    "success": "#22c55e",
    "error": "#ef4444",
    "warning": "#f59e0b",
    "dim": "#6b7280",
    "muted": "#9ca3af",
    "border": "#374151",
    "borderMuted": "#1f2937"
  }
}
```

## Usage

Set your theme in `.pi/settings.json`:

```json
{
  "theme": "my-theme"
}
```

Built-in themes: `dark` (default), `light`.
