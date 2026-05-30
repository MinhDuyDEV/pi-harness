# `.pi/cli/`

Home for project-local CLI wrappers that replace external orchestration and adapter dependencies.

Guidelines:

- Run wrappers through `bash`/local commands from Pi; do not require adapter packages or background services.
- Keep wrappers small, inspectable, and project-scoped.
- Prefer file inputs/outputs under `.pi/plans/<id>/` for durable handoffs.
- Do not hide state in long-running services unless the user explicitly starts them.
- Verify wrapper output before trusting it in implementation or review.

Possible future wrappers:

- `figma-fetch.mjs` — fetch design metadata/assets into a visible artifact.
- `browser-flow.mjs` — run repeatable browser checks and save logs/screenshots.
- `openpencil-client.mjs` — export or inspect `.op` design files from the CLI.
