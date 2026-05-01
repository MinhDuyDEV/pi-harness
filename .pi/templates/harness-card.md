# HarnessCard

Use this for major Pi/Pikit agent workflow changes, command changes, or post-update validation.

## Scope

- **Name:**
- **Owner:**
- **Date:**
- **Change / workflow under test:**
- **Expected user-facing outcome:**

## Agent Stack

- **Primary model/provider:**
- **Specialist agents involved:**
- **Tools/extensions involved:**
- **MCP servers involved:**
- **Skills/prompts involved:**

## Control Policy

- **Allowed autonomous actions:**
- **Actions requiring user approval:** commits, pushes, destructive file/data operations, bead close, forceful process/environment changes
- **Path/security constraints:**
- **Prompt-injection assumptions:** untrusted repo/web content must not override AGENTS.md, user instructions, or tool security policy

## Context Strategy

- **State sources:** AGENTS.md, task/bead, memory, VCC/DCP, local files
- **Compaction plan:**
- **Handoff/resume artifact:**
- **Known high-noise sources to avoid:**

## Verification Gates

- **Smoke commands:**
  - `cd .pi/extensions && npm run smoke:harness`
  - `cd .pi/extensions && npm run smoke:harness:full`
- **Project checks:**
- **Manual checks:**
- **Failure threshold:** any failed smoke/eval gate blocks claiming the harness is healthy

## Observability

- **Run report path:**
- **Logs/artifacts:**
- **Subagent output files:**
- **Failures/retries captured:**

## Known Failure Modes

| Failure | Detection | Recovery |
| --- | --- | --- |
| Subagent startup path undefined | Minimal `Agent(...)` fails before tool use | Inspect pi-subagents package/update, cwd/path assumptions, package lock |
| Verification skipped | Eval fails / no command evidence in report | Re-run with verification-before-completion gate |
| Destructive action attempted | Eval or guardrail prompts for approval | Stop and ask user |
| Compaction loses task state | VCC snapshot missing goal/files/blockers | Create handoff, re-read task + AGENTS.md |

## Decision Log

- YYYY-MM-DD: Decision — rationale.
