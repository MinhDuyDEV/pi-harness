# `.pi/cli/`

Project-local CLI helpers live here when a workflow needs repeatable local automation but should not become a Pi extension.

Use this directory for small scripts that:

- run through `bash` or another local command from Pi;
- do not require MCP adapters, hidden task runners, or background orchestration services;
- take explicit file/path arguments instead of reading hidden runtime state;
- write durable outputs under `.pi/plans/<id>/` when used for handoffs;
- are safe to inspect, rerun, and verify independently.

Do **not** put Pi extension tools here. Extension tools belong in `.pi/extensions/` so Pi can register them through the extension runtime.

Before adding a helper, prefer direct shell commands. Add a script only when the command becomes repeated, error-prone, or needs structured output.

## Candidate wrappers

Browser and UI verification are the main use case for `.pi/cli/` because they benefit from repeatable commands and saved artifacts:

- `browser-devtools.mjs` — connect to an existing Chrome DevTools endpoint, inspect console/network/DOM state, and write findings to `.pi/plans/<id>/BROWSER-DEVTOOLS.md`.
- `playwright-flow.mjs` — run a scripted browser flow with Playwright, save screenshots/traces/logs, and write a summary to `.pi/plans/<id>/PLAYWRIGHT-FLOW.md`.
- `browser-screenshot.mjs` — capture deterministic screenshots for visual review and save outputs under `.pi/plans/<id>/screenshots/`.

Keep these wrappers thin: argument parsing, command execution, artifact writing. Put reusable Pi-facing tools in `.pi/extensions/` instead.
