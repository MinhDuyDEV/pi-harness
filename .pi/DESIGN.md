# Pi harness design

## Boundary

This repository is a Pi package. Pi owns the agent loop, model/provider configuration, trust decisions, sessions, and built-in tools. This package supplies opt-in extensions, curated skills, prompts, themes, and optional `pi-task` agent definitions.

## Loading

Pi loads standard project resources from `.pi/`. `package.json` exposes the same directories when the repository is installed as a package. Project settings do not repeat resource paths and do not force a provider, model, or trust policy.

## Safety and portability

- Package sources are pinned to versions or immutable commits.
- Host Pi packages are peer dependencies; local development pins compatible versions as dev dependencies.
- Optional integrations are not model-invoked by default.
- Read-only specialist agents (reviewer, scout) avoid mutating the tree; the explore agent keeps a read-only posture but may run shell commands for search and discovery.
- Runtime caches, sessions, artifacts, and memory remain local and ignored.

## Verification boundary

The package check validates manifests/settings/skill integrity. TypeScript checks repository and extension sources separately. Test runners execute extension tests and root skill/context tests. CI runs the same gates on a clean checkout.
