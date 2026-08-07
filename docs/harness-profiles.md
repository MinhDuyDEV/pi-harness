# Full harness consumer contract

`pi-harness-init` has one supported capability mode: **Full**. It does not scaffold minimal or standard consumers, and it does not expose an option that omits agents, policy, templates, or other required resources.

A successful init materializes the project-local policy and managed resources, writes exact package pins, and sets `pi-harness.profile` to `full`. Re-running init repairs stale Full-owned gates while preserving consumer-owned provider, model, theme, secret, and unrelated package settings.

## Full runtime surface

The Full profile enables the complete harness workflow surface:

- Herdr state and safety controls (the safety gate itself is off by default; see below)
- shortcut and rewind
- checkpoints and DCP
- diagnostics and integration hooks
- learning coordination and workflow state
- TPS and usage tracking alongside Pi's native fullscreen TUI
- SuperPi and GPT personality prompt shaping
- packaged extensions, skills, prompts, themes, agents, and artifact templates

Pi 0.84 owns fullscreen compositor behavior. The former harness compositor was removed to avoid competing terminal ownership and duplicated rendering state.

The safety extension ships in Full but is disabled by default: `pi-harness.extensions.safety` starts `false`, so destructive-command guards (for example catastrophic `rm`, pipe-to-shell, force-push checks) are not active until a consumer explicitly sets `extensions.safety: true`. This preserves the package's trust boundary — safety is a per-consumer opt-in, not an assumption about the environment.

DeepSeek, Xiaomi/MiMo, and xAI use Pi 0.84's native provider registry and authentication flows. The harness does not register duplicate providers, set a global default provider/model, or install credentials; canonical agent seats may still carry explicit external model pins for reproducible delegation.

The implementation may retain internal profile parsing for compatibility with existing settings, but it is not a second bootstrap contract: the next `pi-harness-init` run converges managed settings back to Full.

## Project-local policy

Pi packages discover extensions, skills, prompts, and themes from the package manifest. Project policy and support files are therefore materialized separately into the consumer repository:

- `.pi/APPEND_SYSTEM.md` with a sentinel-managed harness region
- `.pi/ANTI_PATTERNS.md`
- `.pi/agents/*.md`
- `.pi/templates/*`
- `.pi/pi-harness.lock.json`
- managed runtime-state entries in root `.gitignore`

Consumer prose outside the managed APPEND_SYSTEM region remains untouched. Modified managed files are never overwritten without a matching lock baseline; init reports an explicit conflict instead.

## Agent seat selection

Agent roles are capability envelopes with an explicit canonical model seat. Canonical profiles do not pin credentials or a global provider; their model pins make delegation reproducible across consumer repositories.

Use these routing defaults:

1. **Explorer** — repository discovery and evidence gathering.
2. **Implementer** — focused production changes after scope and contracts are known.
3. **Reviewer** — independent correctness and maintainability review.
4. **Proof auditor** — adversarial evidence validation for high-risk claims.
5. **Peer / General / Scout** — synthesis, broad investigation, or lightweight reconnaissance as their profile contracts describe.

Runtime orchestration selects the available model. Consumers remain free to customize their own agent files; once customized, lock-aware upgrades preserve them and report drift instead of silently replacing them.

## Performance contract

Full is the capability baseline, not a request to run every expensive operation eagerly. Extensions must remain lazy where possible:

- no credential or network requirement at startup;
- diagnostics run after eligible TypeScript tool results or when invoked, but only use a configured/already-installed analyzer and enforce a timeout;
- Pi-native providers and authentication remain host-owned;
- the anti-pattern catalog stays out of the always-on system prompt;
- repeated init performs no writes when bytes already match.

Clean packed-consumer smoke tests compare the initialized consumer with the package resource contract before release.
