# Design-system audit

A design system is a contract between its tokens/specification and component
code. Report every breach with severity, expected value, found value, and a
concrete fix.

## Five audit layers

1. Token coverage: every spec token exists.
2. Token usage: raw values do not replace an existing token.
3. Component consistency: components use the same primitives, states, and
   composition rules.
4. Spec alignment: color, typography, spacing, radius, shadow, icon, and motion
   match the current design source.
5. Composition: components remain usable in real pages and states.

Useful machine-readable output:

```json
{
  "missing": ["color.warning.bg"],
  "raw-values": ["Dialog margin 16px; use spacing.4"],
  "drifted": ["Button radius 8px; spec says 6px"]
}
```

Also count distinct button variants, spacing values, typography styles, border
rules, focus states, and dark-mode token coverage. Classify findings as
`BLOCKER`, `SHOULD-FIX`, or `NIT`; compare against the current spec, never
memory or an obsolete Figma export.

