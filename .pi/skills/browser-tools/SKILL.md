---
name: browser-tools
description: Use when the vendored visible-Chrome helper scripts are explicitly requested and native browser tooling is unavailable.
disable-model-invocation: true
metadata:
  category: optional-integration
  runtime: node-macos
---

# Browser tools (optional, macOS)

Prefer a configured Playwright or browser extension. These helpers connect to a local Chrome instance over port `9222`, require macOS/Google Chrome for `browser-start.js`, and are disabled from automatic model invocation.

## One-time setup

Install dependencies into a persistent user directory so they survive `pi update`/`pi remove`; then link them into the skill directory.

```bash
SKILL_DEPS="$HOME/.pi/agent/skill-deps/browser-tools"
mkdir -p "$SKILL_DEPS"
cp "{baseDir}/package.json" "{baseDir}/package-lock.json" "$SKILL_DEPS/"
npm ci --prefix "$SKILL_DEPS" --ignore-scripts        # persistent; rerun only if deps change
ln -sfn "$SKILL_DEPS/node_modules" "{baseDir}/node_modules"  # relink after pi update/remove
```

`{baseDir}` is this skill's directory. Scripts resolve imports from `{baseDir}/node_modules` (the symlink) into the persistent deps, so they keep working across package updates without reinstalling.

## Typical flow

```bash
node "{baseDir}/browser-start.js"
node "{baseDir}/browser-nav.js" "https://example.com"
node "{baseDir}/browser-content.js" "https://example.com"
node "{baseDir}/browser-screenshot.js"
```

Additional helpers inspect cookies, evaluate JavaScript, or interactively pick elements. Do not use them for API-only/static-text tasks, never copy a user's default profile without explicit permission, close browser sessions, and avoid exposing cookies or credentials in logs.
