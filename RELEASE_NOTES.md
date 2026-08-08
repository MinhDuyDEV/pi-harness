# @minhduydev/pi-harness v2.8.1

## Highlights

- Keeps `@minhduydev/pi-subagents` as the sole governed task lifecycle control plane while adding typed reason codes, durable evidence, and bounded/redacted telemetry.
- Adds optional `pi-peer` root-to-read-only-advisor integration without granting it lifecycle, claim, proof, review, audit, or ship authority.
- Advances the consumer bootstrap pin to `@minhduydev/pi-subagents@0.13.0`.
- Updates the Full-profile interactive decision form pin to `@mrclrchtr/supi-ask-user@4.7.0`.
- Updates the vendored Snap Edit integration to 5.1.0 with stronger diagnostics and corrected newline, indentation, occurrence, byte-state, and diff-coordinate behavior.

## Distribution

- npm package: `@minhduydev/pi-harness@2.8.1`
- Bootstrap command:

  ```bash
  npx --yes --package=@minhduydev/pi-harness@2.8.1 -- pi-harness-init ./my-repo
  ```

- Optional peer advisor:

  ```bash
  pi install npm:pi-peer@1.2.1
  ```

## Release order

Publish and verify `@minhduydev/pi-subagents@0.13.0` and optional advisor `pi-peer@1.2.1` before publishing this harness release.

## Compatibility

- Node.js `>=22.19.0`
- npm `>=11.12.1`
- Pi package suite `0.84.x`
- `@minhduydev/pi-subagents >=0.13.0 <0.14.0`
- Optional advisor `pi-peer >=1.2.1 <1.3.0`

Versions `2.7.0` and `2.8.0` are already immutable on npm; this additive release therefore advances the harness to `2.8.1`.
