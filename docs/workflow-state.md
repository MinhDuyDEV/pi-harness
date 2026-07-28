# Typed workflow state

The Full consumer bootstrap registers `workflow_state`. It persists
three versioned records owned by `@minhduydev/pi-core/workflow`:

- a foundation verdict before implementation is committed;
- a reconciliation checkpoint after backlog state is compared with evidence;
- a handoff pack with all fourteen transfer sections.

Records live under
`.pi/artifacts/workflow-state/records/<kind>/<record-id-digest>.json`. Each
envelope binds the canonical record to `workflowCheckpointDigest()`. A
`record_id` is write-once: an exact retry is idempotent, while different
content under the same id is rejected. Use a revision suffix for a changed
verdict or handoff.

After each successful write the extension emits
`pi-harness:workflow:checkpoint-recorded:v1` with the shared record, digest,
path, and idempotency status.

## Reconciliation trigger

The extension consumes the public `pi-todo:item-completed:v1` and
`pi-todo:phase-closed:v1` events. It durably deduplicates their idempotency keys
in `.pi/artifacts/workflow-state/reconcile-trigger.json`. Four completed items
make reconciliation due. The next model context receives one typed reminder
per session and the extension emits
`pi-harness:workflow:reconcile-due:v1`.

A successful `record_reconcile` write resets the count. Duplicate events,
process restarts, and malformed state are handled explicitly; malformed state
is quarantined and never trusted.

## Fourteen handoff sections

The shared handoff record and `/handoff` use the same sections:

1. Goal
2. Current state
3. Verified
4. Unknowns
5. Real constraints
6. Relevant files / modules
7. Closed decisions
8. Open decisions
9. Existing evidence
10. Expected deliverable
11. Permissions (write scope)
12. Anti-patterns to avoid
13. Next step
14. Resume keys

The Markdown file remains the human-readable transfer document. The typed
record is the validated, digest-bound automation/replay contract.
