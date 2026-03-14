# Integration with Beads

Swarm works on top of Beads:

1. **Session start**: `swarm sync push` to make tasks visible
2. **Leader claims parent** bead
3. **Workers claim child** beads (via delegation packets)
4. **Progress tracked** via `swarm monitor progress_update`
5. **Completion syncs** back via `swarm sync pull`
6. **Close parent** bead with `br close`

```typescript
// Full integration workflow
await swarm({ operation: "sync", action: "push" }); // Make Beads visible
// ... spawn swarm ...
await swarm({ operation: "monitor", action: "render_block", team_name: "..." }); // Monitor progress
// ... monitor completion ...
await swarm({ operation: "sync", action: "pull" }); // Sync completed back
await bash("br close parent-task --reason 'Swarm completed'");
```
