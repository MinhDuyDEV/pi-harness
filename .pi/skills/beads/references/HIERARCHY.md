# Hierarchical Structure: Epic → Task → Subtask

Beads supports up to 3 levels of hierarchy using hierarchical IDs:

```
br-a3f8        (Epic - parent feature)
├── br-a3f8.1  (Task - first child)
├── br-a3f8.2  (Task - second child)
│   ├── br-a3f8.2.1  (Subtask - child of .2)
│   └── br-a3f8.2.2  (Subtask - child of .2)
└── br-a3f8.3  (Task - third child)
```

## When to Decompose

| Scenario                     | Structure                            |
| ---------------------------- | ------------------------------------ |
| Bug fix, config change       | Single bead                          |
| Small feature (1-2 files)    | Single bead                          |
| Feature crossing FE/BE       | Epic + tasks by domain               |
| New system/service           | Epic + tasks by component            |
| Multi-day work               | Epic + tasks for parallelization     |
| Work needing multiple agents | Epic + tasks (agents claim children) |

## Creating Hierarchical Beads

```bash
# Step 1: Create Epic (parent)
br create --title "User Authentication System" --type epic --priority 1 \
  --description "Complete auth with OAuth, sessions, and protected routes"
# Returns: br-a3f8

# Step 2: Create child tasks with parent
br create --title "Database schema for auth" --type task --priority 2 \
  --parent br-a3f8 --description "Create user and session tables"
# Returns: br-a3f8.1  ← Hierarchical ID!

# Step 3: Create dependent tasks
br create --title "OAuth integration" --type task --priority 2 \
  --parent br-a3f8 --blocked-by br-a3f8.1
# Returns: br-a3f8.2
```

## Parallel Execution with Dependencies

```
br-a3f8.1 [Database] ──┬──> br-a3f8.2 [Backend] ──┐
     (READY)           │                          │
                       │                          ▼
                       └──> br-a3f8.3 [Frontend]  br-a3f8.5 [Testing]
                       │         │                     ▲
                       └──> br-a3f8.4 [Docs] ──────────┘

Parallel tracks:
• Agent 1 (backend): .1 → .2
• Agent 2 (frontend): wait for .1, then .3
• Agent 3 (qa): wait for .2 and .3, then .5
```

**Key insight**: After br-a3f8.1 completes, .2, .3, and .4 all become READY simultaneously. Multiple agents can claim them in parallel.

## Querying Hierarchy

```bash
# See all open issues
br list --status open

# See ready work (unblocked tasks)
br ready
# Returns tasks where all dependencies are closed
```
