# Skill migrations

The 1.1 skill consolidation removes aliases whose workflow was materially
covered by a retained skill. These are not empty renames: the destination is
the skill that now owns the decision point and verification loop.

| Removed skill | Load instead | Why |
| --- | --- | --- |
| `accessibility-audit` | `frontend-design` | UI implementation and accessibility review share the same component, semantic, and interaction evidence. |
| `api-and-interface-design` | `deep-module-design` | Public API shape is an interface-depth and information-hiding decision. |
| `browser-testing-with-devtools` | `playwright` | Browser validation, DOM inspection, console/network debugging, and screenshots now live in one test workflow. |
| `defense-in-depth` | `security-and-hardening` | Boundary validation, authorization, secret handling, and layered mitigation are one security review surface. |
| `development-lifecycle` | `development-lifecycle` (retained hidden skill) | The four artifact files and lifecycle hooks are a distinct user-invoked workflow; `superpi` only routes task types. |
| `design-system-audit` | `frontend-design` | Token/component audits are part of the frontend design workflow. |
| `git-workflow-and-versioning` | `shipping-and-launch` | Branch, release, changelog, and rollback decisions are shipping concerns. |
| `memory` | `context-engineering` | Durable/retrieved context is governed by the context budget and source hierarchy. |
| `mockup-to-code` | `frontend-design` | Translating a visual reference into tokens, components, and runtime checks is frontend design work. |
| `redesign-existing-projects` | `frontend-design` | Behavior-preserving visual redesign belongs with typography, tokens, components, accessibility, and browser validation—not code architecture refactoring. |
| `ts-package-authoring` | `typescript-coding-standards` | Package exports, peer dependencies, and public types are TypeScript boundary standards. |
| `source-driven-development` | `context-engineering` | Source selection and provenance are the evidence layer of context engineering. |
| `performance-optimization` | `observability-and-instrumentation` | Performance work begins with measured signals, baselines, and regressions; motion-specific work remains `fixing-motion-performance`. |

Use the destination name in new prompts and automation. Removed names are not
Pi aliases, deliberately: a stale `/skill:<old-name>` must fail visibly rather
than silently loading a different workflow.
