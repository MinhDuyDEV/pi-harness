# Error Handling

## Common Issues

**No ready tasks**

- Run `br list --status open` to see all tasks
- Some may be blocked - check dependencies with `br show <id>`

**Sync failures**

- Run `br doctor` to repair database
- Check git remote access
