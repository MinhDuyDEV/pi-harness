# snap-edit

Vendored port of [`sting8k/pi-snap-edit`](https://www.npmjs.com/package/pi-snap-edit)
@ **5.0.0** (upstream commit `db95928`) providing the `quick_edit` and
`target_edit` tools with atomic, guard-checked editing semantics.

## Why this is vendored (not npm-pinned)

Upstream `pi-snap-edit@5.0.0` declares peer dependencies
`@earendil-works/pi-coding-agent@^0.78.0` and `@earendil-works/pi-tui@^0.78.0`.
On a 0.x range, `^0.78.0` resolves to `>=0.78.0 <0.79.0`, so it **ERESOLVEs**
against this harness's pinned Pi **0.81.1** host. The 5.0.0 release retains the
same incompatible peer range as 4.x, so no compatible npm pin exists.

The runtime API the package needs (`ExtensionAPI.registerTool/getActiveTools/
setActiveTools/on`, `withFileMutationQueue`, `keyHint`, and `pi-tui`'s `Text`)
is fully present in Pi 0.81.1 — the conflict is purely a solver/peer-range
issue. Vendoring the source here and binding it to the host's already-installed
0.81.1 packages is the smallest maintainable boundary that preserves the
proven atomic editing logic without an incompatible npm pin or
`--force`/`--legacy-peer-deps`.

## The one adaptation

The only change to the vendored source is in `schemas.ts`:

```diff
-import { Type } from "@sinclair/typebox";
+import { Type } from "typebox";
```

`@sinclair/typebox` was renamed to `typebox`; the host pins `typebox@1.1.38`,
whose `Type` builder API is compatible with the schema shapes used here
(`Object`, `String`, `Integer`, `Optional`, `Union`, `Literal`, `Array` with
options). Every editing routine (`quick-edit.ts`, `target-edit.ts`, `fuzzy.ts`,
`anchors.ts`, `diff.ts`, …) is unchanged.

## Layout

- `extension.ts` — upstream `src/index.ts` verbatim (the register function,
  `session_start` active-tool preference, and the `tool_result` read hook).
- `schemas.ts` … `text.ts` — upstream source verbatim (except the typebox
  import above).
- `index.ts` — a thin harness wrapper that honors the
  `pi-harness.extensions.snapEdit` gate (default off except in the `full`
  profile) before delegating to `extension.ts`.

## Upstream 5.0 behavior

- `target_edit` cascades through exact, unescaped, then whole-line trim
  matching. Non-exact successes report the resolved tier.
- A trim replacement preserves the file's indentation; a trim deletion removes
  the whole matched line instead of leaving an indentation-only line.
- The previously unregistered `substitute_edit` engine/schema/export has been
  removed. Its active-tool filter remains to clean legacy saved session state.

## Activation

`quick_edit`/`target_edit` replace `edit`/`substitute_edit` for the active
session when the extension is enabled. Enable per-repo via
`.pi/settings.json`:

```json
{ "pi-harness": { "extensions": { "snapEdit": true } } }
```

or by using the `full` profile. `pi-harness-init` owns Full-profile gates and restores `snapEdit: true` on re-init; installations maintained outside that lifecycle may set `snapEdit: false` to keep Pi's built-in editing tools.

## Re-vendoring

To update from a future upstream release: replace the vendored files with the
new `src/*.ts`, rename upstream `src/index.ts` to `extension.ts`, remove source
files deleted upstream, re-apply the `typebox` import swap in `schemas.ts`, and
keep `index.ts` plus `index.test.ts` as harness-owned files. Re-run
`npm run test:extensions`, `npm run typecheck:extensions`, and
`npm run typecheck:extension-tests`.
