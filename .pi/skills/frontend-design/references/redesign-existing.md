# Behavior-preserving visual redesign

Redesign the visual layer without changing information architecture, user flows,
copy, API contracts, or working behavior.

## Audit before implementation

Capture every screen and state (loading, empty, error, success), list what is
already working, and name concrete “AI tells”: generic centered hero/gradient,
random typography, magic spacing, card/shadow overload, missing focus states,
or decorative animation without purpose. Identify the product's voice before
choosing a style.

## Migration order

1. Typography and type scale.
2. Neutral ramp and restrained brand color.
3. Spacing scale.
4. Shared buttons, inputs, cards, dialogs, and states.
5. Page composition and responsive layout.

Migrate one component/pattern at a time, preferably behind a flag and with
isolated visual tests. Use real data and mobile states. Remove the old path only
after runtime and visual evidence shows parity. “Premium” is not a reason to add
gradients, blur, gold, or motion; every visual change needs a product purpose.
