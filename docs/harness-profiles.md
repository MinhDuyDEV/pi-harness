# Harness profiles and seat roles

`pi-harness` loads extension modules as package resources, then each entry
checks the consumer-owned `.pi/settings.json` before registering hooks, tools,
providers, or UI. The bootstrap writes the `standard` profile; the source
checkout uses `full`.

| Profile | Enabled extension keys |
|---|---|
| `minimal` | `safety`, `herdrState` |
| `standard` | minimal + `shortcutContinue`, `checkpoint`, `rewind`, `learningCoordinator`, `workflowState` |
| `full` | standard + `dcp`, `tui`, `tps`, `diagnostics`, `integration`, `usageTracker` |

Per-extension booleans under `pi-harness.extensions` override the selected
profile. Provider registrations (`deepseek`, `mimo`, `xai`) are a deliberate
exception: they remain off in every profile and require an explicit `true`.
Prompt-shaping entries use the separate `pi-harness.superpi` and
`pi-harness.gptPersonality` booleans.

```json
{
  "pi-harness": {
    "profile": "standard",
    "superpi": false,
    "gptPersonality": false,
    "extensions": {
      "checkpoint": false,
      "deepseek": true
    }
  }
}
```

When the same package is used by independent Herdr seats, set
`PI_HARNESS_SEAT_ROLE` explicitly:

- `root` (or an absent variable) is the interactive supervising seat.
- `implementer` and `peer` are worker seats. They retain only `safety` and
  `herdrState`; prompt shaping and fan-out-capable/write-heavy harness
  extensions stay off even if a profile or per-key setting enables them.
- Any other non-empty value is an unknown seat and fails closed to the worker
  restriction; `herdrState` itself declines to report an unknown role.

The role variable is intentionally explicit because Herdr's public pane env
does not expose authoritative role metadata to extensions. A room launcher
that passes `--role implementer` or `--role peer` must also export the matching
`PI_HARNESS_SEAT_ROLE`; the harness never guesses from a pane label.

Outside Herdr, `herdrState` registers nothing unless `HERDR_ENV=1`,
`HERDR_SOCKET_PATH`, and `HERDR_PANE_ID` are all present. Its socket attempts
are bounded and fail-silent. Current Herdr's report API accepts
`working|blocked|idle`; a process quit uses `pane.release_agent`. The harness
does not invent unsupported `done/stopped/error` wire states.
