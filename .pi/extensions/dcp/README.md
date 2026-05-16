# DCP Extension Tools

This extension owns compaction policy and adds session context tools.

## Tools

`vcc_recall` is intentionally owned by `@sting8k/pi-vcc` in this project so deterministic pi-vcc recall can coexist with DCP runtime pruning.

### `vcc_snapshot`
Build deterministic summary sections from session JSONL (no LLM calls).

- Params:
  - `query?: string` — optional filter (regex-first, fallback OR words)
  - `limit?: number` — number of source rows to summarize (default `400`, max `2000`)
- Sections:
  - `[Session Goal]`
  - `[Files And Changes]`
  - `[Outstanding Context]`
  - `[User Preferences]`
  - Brief transcript
- Security: redacts common secret patterns (`password`, `api_key`, `secret`, `token`, `sshpass`, `-i *.pem`).

Examples:
- `vcc_snapshot()`
- `vcc_snapshot({"query":"dcp.ts|snapshot.ts","limit":200})`

## Smoke test

Run from repository root:

```bash
npm --prefix .pi/extensions run smoke:vcc-snapshot
```

The smoke test bundles and executes `dcp/scripts/smoke-snapshot.ts`, then validates:
- JSONL parsing
- file activity extraction
- section rendering
- secret redaction
