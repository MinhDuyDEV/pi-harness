# Shell hook templates

**Reference templates only — Pi does not auto-run these.** There is no shell-hook mechanism in
the Pi SDK (`@earendil-works/pi-coding-agent` documents only the TypeScript extension API in
`docs/extensions.md`), and this harness ships no extension that executes scripts from this
directory. Wire these up via your own extension or your repo's own tooling if you want them
active.

## What is here

| Script | Intent |
|---|---|
| `session-start.sh` | Prints a session banner (example of a session-start action) |
| `pre-tool-use.sh` | Blocks `curl \| bash` patterns in bash tool commands (exit non-zero to block) |
| `pre-commit.sh` | Enforces Conventional Commits on the commit message (blocks on mismatch) |
| `examples/*.sh.example` | More stubs following the same shape (read JSON payload on stdin, print JSON or exit non-zero) |

The scripts read `PI_*` environment variables (`PI_TOOL_NAME`, `PI_TOOL_ARGS`, `PI_COMMIT_MSG`,
`PI_SESSION_ID`, ...). Whatever wiring you build must set those variables — or adapt the scripts
to your own contract.

## Ways to wire them

- **Pi extension**: write a `.pi/extensions/` extension that subscribes to the events you care
  about (e.g. `tool_call`, `session_start`) and spawns the matching script; see
  `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`.
- **Git hooks / CI**: `pre-commit.sh` works as a plain `commit-msg`-style guard — call it from
  `.git/hooks/` or CI with `PI_COMMIT_MSG` set to the commit message.
