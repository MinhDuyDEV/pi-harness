# Pi Shell Hooks

This project supports optional shell-script hooks through `.pi/extensions/hooks.ts`.

## Search Paths

Hooks are resolved per scope in this order:

1. Global: `~/.pi/agent/shell-hooks/`
2. Global legacy fallback: `~/.pi/agent/hooks/`
3. Project: `.pi/shell-hooks/`
4. Project legacy fallback: `.pi/hooks/`

For a given hook file, Pi picks the first executable script found in each scope.
If both a global and project hook exist, **global runs first**, then **project**.

## Available Hook Files

| File | Event | Environment variables | Structured stdout | Can block |
|---|---|---|---|---|
| `session-start.sh` | `session_start` | `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_CWD`, `PI_SESSION_REASON` | Ignored | No |
| `before-agent-start.sh` | `before_agent_start` | `PI_PROMPT`, `PI_SYSTEM_PROMPT`, `PI_IMAGE_COUNT`, `PI_SESSION_ID` | `{"systemMessage":"..."}`, `{"systemPrompt":"..."}`, or `{"message":{...}}` | No |
| `input.sh` | `input` | `PI_USER_INPUT`, `PI_INPUT_SOURCE`, `PI_SESSION_ID` | `{"action":"transform","text":"..."}` or `{"action":"handled"}` | No |
| `pre-tool-use.sh` | `tool_call` | `PI_TOOL_NAME`, `PI_TOOL_ARGS` (JSON), `PI_TOOL_CALL_ID`, `PI_SESSION_ID` | `{"action":"block","reason":"..."}` or `{"input":{...}}` | Yes |
| `pre-commit.sh` | `tool_call` (only when `bash` is `git commit ...`) | `PI_COMMIT_MSG`, `PI_FILES`, `PI_TOOL_ARGS`, `PI_SESSION_ID` | `{"action":"block","reason":"..."}` | Yes |
| `post-tool-use.sh` | `tool_result` | `PI_TOOL_NAME`, `PI_TOOL_ARGS`, `PI_TOOL_CALL_ID`, `PI_TOOL_IS_ERROR`, `PI_TOOL_RESULT_TEXT`, `PI_TOOL_RESULT_DETAILS` | `{"content":"replacement text","details":{...},"isError":false}` | No |
| `user-bash.sh` | `user_bash` | `PI_BASH_COMMAND`, `PI_USER_BASH_COMMAND`, `PI_BASH_EXCLUDE_FROM_CONTEXT`, `PI_SESSION_ID` | `{"action":"block","reason":"..."}` or `{"result":{...}}` | Yes |
| `agent-end.sh` | `agent_end` | `PI_MESSAGE_COUNT`, `PI_SESSION_ID` | Ignored | No |
| `turn-end.sh` | `turn_end` | `PI_TURN_INDEX`, `PI_TOOL_RESULTS_COUNT`, `PI_SESSION_ID` | Ignored | No |
| `session-stop.sh` | `session_shutdown` | `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_CWD`, `PI_SESSION_REASON` | Ignored | No |

## Structured Protocol

Every hook receives a JSON payload on **stdin**.
This is the preferred interface for new hooks.

Example stdin payload for `pre-tool-use.sh`:

```json
{
  "hook_event": "tool_call",
  "hook_file": "pre-tool-use.sh",
  "hook_scope": "project",
  "session_id": "abc123",
  "cwd": "/path/to/repo",
  "tool_name": "bash",
  "tool_call_id": "toolu_01",
  "input": {
    "command": "git status"
  }
}
```

### Stdout behavior

- If stdout is not JSON, Pi treats it as plain output.
- For blocking hooks, non-zero exit still blocks, using stdout/stderr as the reason.
- For structured hooks, print **only JSON to stdout**. Send logs to stderr.

### Supported structured outputs

#### `before-agent-start.sh`

Append deterministic instructions to the current system prompt:

```json
{"systemMessage":"Always summarize changed files before proposing a commit."}
```

Or fully replace the turn system prompt:

```json
{"systemPrompt":"You are operating in strict review-only mode for this turn."}
```

Inject extra hidden context as a custom message:

```json
{"message":{"content":"Repository policy: run tests before edits.","display":false}}
```

#### `input.sh`

Transform the prompt:

```json
{"action":"transform","text":"Summarize README.md first"}
```

Short-circuit normal processing:

```json
{"action":"handled"}
```

#### `pre-tool-use.sh`

Block execution:

```json
{"action":"block","reason":"Do not run rm -rf without confirmation."}
```

Rewrite tool input in-place:

```json
{"input":{"command":"git status --short"}}
```

#### `post-tool-use.sh`

Replace tool text output:

```json
{"content":"Sanitized output shown by hook."}
```

Or replace full structured content/details:

```json
{
  "content": [{"type":"text","text":"Sanitized output shown by hook."}],
  "details": {"sanitized": true},
  "isError": false
}
```

#### `user-bash.sh`

Block a direct `!` / `!!` shell command:

```json
{"action":"block","reason":"Direct npm publish is disabled on this machine."}
```

Or fully replace execution with a synthetic result:

```json
{
  "result": {
    "output": "Hook handled this command.",
    "exitCode": 0,
    "cancelled": false,
    "truncated": false
  }
}
```

## Behavior

- Hooks are optional. Missing directories/files are ignored.
- Hook scripts must be executable.
- Timeout defaults to **10s** and can be configured with `PI_HOOK_TIMEOUT_MS`.
- Passive hooks (`session-start.sh`, `agent-end.sh`, `turn-end.sh`, `session-stop.sh`) log failures in debug mode and continue.
- `before-agent-start.sh` can modify the turn system prompt and inject one hidden custom message.
- Blocking hooks (`pre-tool-use.sh`, `pre-commit.sh`, `user-bash.sh`) can deny execution either by:
  - exiting non-zero, or
  - printing structured block JSON.
- Existing env-var-only hooks remain supported for backward compatibility.

## Use It Now

### Global hooks for all repos

Copy a hook into `~/.pi/agent/shell-hooks/` if you want it available everywhere:

```bash
mkdir -p ~/.pi/agent/shell-hooks
cp .pi/shell-hooks/examples/pre-tool-use.sh.example ~/.pi/agent/shell-hooks/pre-tool-use.sh
chmod +x ~/.pi/agent/shell-hooks/pre-tool-use.sh
```

You can do the same for the new hook phases:

```bash
cp .pi/shell-hooks/examples/before-agent-start.sh.example ~/.pi/agent/shell-hooks/before-agent-start.sh
cp .pi/shell-hooks/examples/post-tool-use.sh.example ~/.pi/agent/shell-hooks/post-tool-use.sh
cp .pi/shell-hooks/examples/user-bash.sh.example ~/.pi/agent/shell-hooks/user-bash.sh
cp .pi/shell-hooks/examples/agent-end.sh.example ~/.pi/agent/shell-hooks/agent-end.sh
cp .pi/shell-hooks/examples/turn-end.sh.example ~/.pi/agent/shell-hooks/turn-end.sh
cp .pi/shell-hooks/examples/session-stop.sh.example ~/.pi/agent/shell-hooks/session-stop.sh
chmod +x ~/.pi/agent/shell-hooks/before-agent-start.sh ~/.pi/agent/shell-hooks/post-tool-use.sh ~/.pi/agent/shell-hooks/user-bash.sh ~/.pi/agent/shell-hooks/agent-end.sh ~/.pi/agent/shell-hooks/turn-end.sh ~/.pi/agent/shell-hooks/session-stop.sh
```

### Project-only hooks

If you want hooks only for the current repo:

```bash
mkdir -p .pi/shell-hooks
cp .pi/shell-hooks/examples/pre-tool-use.sh.example .pi/shell-hooks/pre-tool-use.sh
chmod +x .pi/shell-hooks/pre-tool-use.sh
```

### Verify

Run `/hooks` in Pi to confirm the hook is active and to see which path was selected.

## Setup

1. Copy an example script from `.pi/shell-hooks/examples/`.
2. Rename it to the exact hook filename you want.
3. Place it in either `.pi/shell-hooks/` or `~/.pi/agent/shell-hooks/`.
4. Make it executable at its final location.
5. Run `/hooks` in Pi to inspect active hooks and search paths.

## Notes

- `PI_TOOL_ARGS` and `PI_TOOL_RESULT_DETAILS` are JSON strings.
- `PI_FILES` is newline-delimited staged file paths from `git diff --cached --name-only`.
- `PI_COMMIT_MSG` is parsed from `git commit -m` / `--message=` when available.
- `session-stop.sh` is process/session shutdown, while `agent-end.sh` runs after each completed agent loop.
- `user-bash.sh` applies to direct `!` / `!!` user shell commands, not LLM-invoked `bash` tool calls.
- New hooks should prefer stdin JSON over environment parsing when practical.
