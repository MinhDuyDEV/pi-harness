# Mockup-to-code workflow

Translate a Figma file, screenshot, or wireframe into token-driven production
components. Preserve behavior and accessibility while matching the visual
reference.

1. Inspect the reference and list pages, states, responsive breakpoints,
   typography, colors, spacing, radius, shadows, icons, and motion.
2. Extract tokens before writing components; identify existing tokens to reuse
   and explicitly flag unavailable assets/fonts.
3. Build in this order: global tokens and type, layout shell, navigation,
   repeated primitives, page-specific content, then loading/empty/error states.
4. Keep components composable and data-driven; use real representative data,
   not lorem ipsum.
5. Validate at three levels: static (type/lint), runtime (user flow and
   accessibility), and visual (screenshots at target widths and key states).
6. Iterate from the largest visual mismatch first; do not compensate with
   arbitrary one-off CSS values.

Behavior, information architecture, API contracts, and copy are unchanged
unless the request explicitly includes them. Use `playwright` for repeatable
screenshots and interaction evidence.

