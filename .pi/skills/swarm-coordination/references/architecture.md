# Swarm Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         BUILD AGENT (Leader)                     │
│  - Parses plan into tasks                                        │
│  - Creates delegation packets                                    │
│  - Spawns worker agents via Task tool                            │
│  - Monitors progress via swarm tool                             │
│  - Synthesizes final results                                     │
└─────────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  WORKER-1   │      │  WORKER-2   │      │  WORKER-3   │
│  (general)  │      │  (general)  │      │  (general)  │
│             │      │             │      │             │
│ - Read      │      │ - Read      │      │ - Read      │
│   delegation│      │   delegation│      │   delegation│
│ - Execute   │      │ - Execute   │      │ - Execute   │
│ - Report    │      │ - Report    │      │ - Report    │
└─────────────┘      └─────────────┘      └─────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
                     ┌─────────────────┐
                     │   RECONCILER    │
                     │                 │
                     │ - Watch CI      │
                     │ - Detect broken │
                     │ - Spawn fixes   │
                     └─────────────────┘
                               │
                               ▼
                     ┌─────────────────┐
                     │  PROGRESS +     │
                     │  TODO PERSIST   │
                     └─────────────────┘
```
