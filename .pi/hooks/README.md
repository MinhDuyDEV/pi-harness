# Pi Shell Hooks

This project supports optional shell-script hooks through `.pi/extensions/hooks.ts`.

Hooks are loaded from:

1. Global: `~/.pi/agent/hooks/`
2. Project: `.pi/hooks/`

If both exist, **global hooks run first**, then **project hooks**.

## Available Hook Files

| File | Event | Environment variables | Can block |
|---|---|---|---|
| `session-start.sh` | `session_start` | `PI_SESSION_ID`, `PI_CWD` | No |
| `pre-tool-use.sh` | `before_tool_call` | `PI_TOOL_NAME`, `PI_TOOL_ARGS` (JSON), `PI_SESSION_ID` | Yes |
| `input.sh` | `input` | `PI_USER_INPUT`, `PI_SESSION_ID` | No |
| `pre-commit.sh` | `before_tool_call` (when `bash` command starts with `git commit`) | `PI_COMMIT_MSG`, `PI_FILES`, `PI_SESSION_ID` | Yes |

## Behavior

- Hooks are optional. Missing directories/files are ignored.
- Each script runs with a 5s timeout.
- Hook execution is logged with `[hooks]` debug logs.
- Blocking hooks (`pre-tool-use.sh`, `pre-commit.sh`) can deny execution by exiting non-zero.
- Non-blocking hooks log failures and continue.

## Setup

1. Copy an example script from `.pi/hooks/examples/`.
2. Rename to the exact hook filename (for example: `.pi/hooks/pre-tool-use.sh`).
3. Make it executable:

```bash
chmod +x .pi/hooks/pre-tool-use.sh
```

4. Run `/hooks` in Pi to see active hooks and paths.

## Notes

- `PI_TOOL_ARGS` is passed as JSON text.
- `PI_FILES` is newline-delimited staged file paths from `git diff --cached --name-only`.
- `PI_COMMIT_MSG` is parsed from `git commit -m` / `--message=` when available.
