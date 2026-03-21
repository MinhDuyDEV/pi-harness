# Nudge System

The nudge system provides self-monitoring triggers that remind the agent to manage context
at appropriate moments. Ported from DCP's prompt injection system.

## Nudge Hierarchy

| Nudge Type           | Trigger Condition                        | Priority | Frequency        |
| -------------------- | ---------------------------------------- | -------- | ---------------- |
| Context Limit Nudge  | Context above `maxContextLimit` (150k)   | Critical | Every 5th fetch  |
| Turn Nudge           | Context between min/max at user turn     | Medium   | At turn boundary |
| Iteration Nudge      | 15+ messages since last user message     | Medium   | Once per trigger |

## Context Limit Nudge (Critical)

**Trigger**: Context is at or beyond the configured max context threshold (default: 150k tokens).

**Response**: This is an emergency context-recovery moment. You **MUST** compress now.

### Range Strategy (Mandatory)

1. Prioritize **one large, closed, high-yield compression range** first
2. This overrides the normal preference for many small compressions
3. Only split into multiple compressions if one large range would reduce summary quality

### Range Selection

- Start from older, resolved history
- Capture as much stale context as safely possible in one pass
- Avoid the newest active working slice unless it is clearly closed

### Summary Requirements

- Cover all essential details so work can continue without reopening raw content
- If compressed range includes user messages, preserve user intent exactly
- Prefer direct quotes for short user messages to avoid semantic drift

**Mental prompt**:

> _CRITICAL: Context limit reached. I must compress now. Start from older resolved history
> and capture as much stale context as possible. One large range first, then smaller if needed.
> Do not continue normal work until compression is handled._

## Turn Nudge (Medium)

**Trigger**: Context is between `minContextLimit` (50k) and `maxContextLimit` (150k) tokens,
and a new user message has arrived.

**Response**: Evaluate the conversation for compressible ranges.

### Behavior

- If any range is cleanly closed and unlikely to be needed again, compress it
- If direction has shifted, compress earlier ranges that are now less relevant
- Prefer small, closed-range compressions over one broad compression
- Keep active context uncompressed

**Mental prompt**:

> _Context is growing. Before proceeding, are there any closed conversation ranges I can
> compress? Has the direction shifted, making earlier exploration stale?_

## Iteration Nudge (Medium)

**Trigger**: 15+ messages have occurred since the last user message (agent has been iterating
autonomously for a while).

**Response**: Check for closed portions that can be compressed.

### Behavior

- If there is a closed portion unlikely to be referenced immediately (e.g., finished research
  before implementation), compress it now
- Prefer multiple short, closed ranges over one large range when several independent slices
  are ready

**Mental prompt**:

> _I've been iterating for a while. Is there a closed portion — like finished research before
> implementation — that I can compress to free context?_

## Nudge Configuration Defaults

| Setting                    | Default | Description                                         |
| -------------------------- | ------- | --------------------------------------------------- |
| `maxContextLimit`          | 150000  | Tokens above which critical nudges fire              |
| `minContextLimit`          | 50000   | Tokens below which turn/iteration nudges are off     |
| `nudgeFrequency`           | 5       | How often context-limit nudge fires (every Nth turn) |
| `iterationNudgeThreshold`  | 15      | Messages since last user message before nudge fires  |
| `nudgeForce`               | "soft"  | How likely compression is after user messages        |

## Nudge Force Levels

| Level    | Behavior                                                              |
| -------- | --------------------------------------------------------------------- |
| `soft`   | Light suggestion to evaluate — compression less likely after user msg |
| `strong` | Stronger push toward compression — more likely after user messages    |

## Self-Monitoring Protocol

Since these nudges are behavioral (not injected by code), follow this self-monitoring protocol:

### At Every Turn Start

1. Estimate current context usage (rough token count)
2. If above 150k → apply Context Limit Nudge behavior
3. If between 50k–150k → apply Turn Nudge behavior
4. If below 50k → no action needed

### During Autonomous Iteration

1. Count messages since last user input
2. If count > 15 → apply Iteration Nudge behavior
3. Check for closed conversation segments that can be compressed

### After Completing a Phase

1. Always evaluate the completed phase for compression
2. This is the natural moment to compress — don't defer
