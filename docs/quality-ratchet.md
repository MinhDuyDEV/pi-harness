# Full-project quality debt ratchet

`npm run quality:ratchet` scans the complete supported source tree with the
pinned `aislop` version and compares the result with
`quality/aislop-debt-baseline.json`.

The baseline is a debt budget, not an ignore list. The gate rejects:

- a lower project score;
- a smaller supported-source scan scope;
- a larger total or per-engine finding count;
- a new finding identity or a higher count for an existing identity.

Finding identity excludes line and column, so moving code does not create a
false regression. Tool version and report-schema version are part of the
contract. The gate does not call a model, network service, or changing
heuristic outside the lockfile.

When cleanup removes accepted debt, the gate deliberately asks for a baseline
update. Run:

```bash
npm run quality:ratchet:update
npm run quality:ratchet
```

Review the JSON diff before committing it. The lower budget then becomes the
new ceiling, so removed debt cannot silently return. Do not update the baseline
to make a regression green; fix the new finding instead.

Changed-file `aislop` remains useful for focused PR feedback. The ratchet is
the project-wide regression gate and runs as part of `npm run quality`.
