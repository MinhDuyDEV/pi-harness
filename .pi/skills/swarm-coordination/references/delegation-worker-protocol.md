# Delegation Packet Structure and Worker Protocol

## Delegation Packet Structure

```markdown
# Delegation Packet

- TASK: task-1 - Implement auth service
- EXPECTED OUTCOME: Auth service with JWT tokens, tests pass
- REQUIRED TOOLS:
  - read
  - grep
  - lsp
  - edit
  - bash
- MUST DO:
  - LSP before edits
  - Run npm test after changes
  - Follow existing code patterns
- MUST NOT DO:
  - No new dependencies
  - Don't edit config files
  - Don't modify shared utilities
- ACCEPTANCE CHECKS:
  - typecheck: npm run typecheck
  - lint: npm run lint
  - test: npm test
- CONTEXT:
  See .beads/artifacts/task-1/spec.md for requirements
```

## Worker Protocol (Updated with Progress Tracking)

Workers follow this execution pattern:

### 1. Read Delegation

```typescript
// First action: read the delegation packet
read({ filePath: ".beads/artifacts/<task-id>/delegation.md" });
```

### 2. Announce Start with Progress

```typescript
await swarm({
  operation: "monitor",
  operation: "progress_update",
  team_name: "plan-implementation",
  worker_id: "worker-1",
  phase: "explore", // or "generate", "reflect", etc.
  progress: 0,
  status: "working",
  file: "src/api/users.ts", // current file being worked on
});
```

### 3. Execute Task with Progress Updates

Follow the MUST DO constraints. Avoid MUST NOT DO items. Use required tools only.

Report progress every 25%:

```typescript
// At 25%, 50%, 75% completion
await swarm({
  operation: "monitor",
  operation: "progress_update",
  team_name: "plan-implementation",
  worker_id: "worker-1",
  phase: "explore",
  progress: 25, // or 50, 75
  status: "working",
  file: "src/api/users.ts",
});
```

### 4. Run Acceptance Checks

```bash
# Run each check from the delegation packet
npm run typecheck
npm run lint
npm test
```

### 5. Report Completion

```typescript
// Mark as completed
await swarm({
  operation: "monitor",
  operation: "progress_update",
  team_name: "plan-implementation",
  worker_id: "worker-1",
  phase: "explore",
  progress: 100,
  status: "completed",
  file: "src/api/users.ts",
});
```

## Error Handling

### Worker Fails Acceptance Checks

Workers report failures via progress updates with error status:

```typescript
// Worker reports error via progress update
await swarm({
  operation: "monitor",
  operation: "progress_update",
  team_name: "plan-implementation",
  worker_id: "worker-1",
  phase: "explore",
  progress: 75,
  status: "error",
  message: "typecheck failed: missing type for AuthToken",
});
```

### Leader Response

1. Check worker status via `swarm({ operation: "monitor", operation: "status" })`
2. Review error details in progress entries
3. Decide: fix locally or reassign to new worker

### Worker Gets Blocked

Workers should report blockers via progress updates:

```typescript
// Worker reports blocker via progress update
await swarm({
  operation: "monitor",
  operation: "progress_update",
  team_name: "plan-implementation",
  worker_id: "worker-2",
  phase: "explore",
  progress: 50,
  status: "blocked",
  message: "Need auth service types from worker-1",
});
```
