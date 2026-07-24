---
name: brave-search
description: Use when an explicit Brave Search API workflow is requested and no host-provided web search tool is available.
disable-model-invocation: true
metadata:
  category: optional-integration
  runtime: node
---

# Brave Search (optional)

Prefer a host-provided web search/fetch tool when available. This vendored fallback requires `BRAVE_API_KEY` and local dependencies; it is disabled from automatic model invocation to avoid hidden network and credential requirements.

## One-time setup

Install dependencies into a persistent user directory so they survive `pi update`/`pi remove`; then link them into the skill directory.

```bash
SKILL_DEPS="$HOME/.pi/agent/skill-deps/brave-search"
npm ci --prefix "$SKILL_DEPS" --ignore-scripts        # persistent; rerun only if deps change
ln -sfn "$SKILL_DEPS/node_modules" "{baseDir}/node_modules"  # relink after pi update/remove
export BRAVE_API_KEY="..."
```

`{baseDir}` is this skill's directory. Scripts resolve imports from `{baseDir}/node_modules` (the symlink) into the persistent deps, so they keep working across package updates without reinstalling.

Never print or commit the API key.

## Commands

```bash
node "{baseDir}/search.js" "query" -n 5
node "{baseDir}/search.js" "query" --content
node "{baseDir}/search.js" "query" --freshness pw
node "{baseDir}/content.js" "https://example.com/article"
```

Use `--country <code>` for regional results and `--freshness pd|pw|pm|py|<date-range>` for time filtering. Cite returned URLs and distinguish fetched evidence from inference.
