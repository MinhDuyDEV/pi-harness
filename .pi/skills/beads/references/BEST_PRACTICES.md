# Best Practices

## Daily/Weekly Maintenance

| Task         | Frequency      | Command               | Why                                            |
| ------------ | -------------- | --------------------- | ---------------------------------------------- |
| Health check | Weekly         | `br doctor`           | Repairs database issues, detects orphaned work |
| Cleanup      | Every few days | `br cleanup --days 7` | Keep DB under 200-500 issues for performance   |

## Key Principles

1. **Plan outside Beads first** - Use planning tools, then import tasks to beads
2. **One task per session, then restart** - Fresh context prevents confusion
3. **File lots of issues** - Any work >2 minutes should be tracked
4. **"Land the plane" = PUSH** - `br sync --flush-only` + git commit/push, not "ready when you are"
5. **Include issue ID in commits** - `git commit -m "Fix bug (br-abc)"`

## Database Health

```bash
# Check database size
br list --status all --json | wc -l

# Target: under 200-500 issues
# If over, run cleanup more aggressively:
br cleanup --days 3
```
