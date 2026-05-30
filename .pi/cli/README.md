# `.pi/cli/`

Project-local CLI helpers live here when a workflow needs repeatable local automation but should not become a Pi extension.

Use this directory for small scripts that:

- run through `bash` or another local command from Pi;
- do not require background services unless the user explicitly starts them;
- take explicit file/path arguments instead of reading hidden runtime state;
- write durable outputs under `.pi/plans/<id>/` when used for handoffs;
- are safe to inspect, rerun, and verify independently.

Do **not** put Pi extension tools here. Extension tools belong in `.pi/extensions/` so Pi can register them through the extension runtime.

Before adding a helper, prefer direct shell commands. Add a script only when the command becomes repeated, error-prone, or needs structured output.

## Browser wrappers

Browser and UI verification are the main use case for `.pi/cli/` because they benefit from repeatable commands and saved artifacts.

- `browser-devtools.mjs` — connects to an existing Chrome DevTools endpoint, inspects page/console/network state, and writes `.pi/plans/<id>/BROWSER-DEVTOOLS.md`.
- `playwright-flow.mjs` — runs a scripted browser flow with Playwright, saves screenshots/traces/logs, and writes `.pi/plans/<id>/PLAYWRIGHT-FLOW.md`.
- `browser-screenshot.mjs` — captures deterministic responsive screenshots and writes `.pi/plans/<id>/SCREENSHOTS.md` plus `.pi/plans/<id>/screenshots/*.png`.

Examples:

```bash
.pi/cli/browser-devtools.mjs --work-id my-check --url http://localhost:3000 --eval 'document.title'
.pi/cli/playwright-flow.mjs --work-id my-check --url http://localhost:3000 --step snapshot --step screenshot=home.png
.pi/cli/browser-screenshot.mjs --work-id my-check --url http://localhost:3000 --full-page
```

Keep wrappers thin: argument parsing, command execution, artifact writing. Put reusable Pi-facing tools in `.pi/extensions/` instead.
