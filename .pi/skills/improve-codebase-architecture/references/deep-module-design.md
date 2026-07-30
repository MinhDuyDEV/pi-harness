# Deep Module Design

Use this reference when a refactor changes module boundaries or public interfaces. The owning workflow remains `improve-codebase-architecture`; this file supplies the focused depth analysis formerly exposed as a separate skill.

## Core idea

A deep module provides substantial capability behind a small, stable interface. A shallow module exposes nearly as much complexity as it hides.

## Depth Metric

Estimate depth as:

```text
Depth = hidden implementation complexity / interface complexity
```

This is a reasoning aid, not a precise score. Prefer boundaries where callers need fewer concepts, fewer ordering rules, and fewer error cases.

## Evaluation loop

1. List the concepts, methods, configuration, sequencing rules, and exceptions callers must understand.
2. Identify complexity that can move behind the boundary without hiding important policy.
3. Design at least two materially different interfaces before choosing one.
4. Keep policy decisions in the implementation; expose capabilities rather than mechanisms.
5. Verify that common callers become simpler and that tests can exercise the boundary without mocking internals.

## Warning signs

- Many one-method wrappers that only forward calls.
- Configuration objects that leak every implementation choice.
- Callers must invoke methods in a precise order.
- Exceptions reveal internal phases rather than domain outcomes.
- Splitting a coherent implementation into many tiny public classes increases navigation cost.

## When not to deepen

Do not collapse boundaries that protect independent ownership, security, failure isolation, replaceability, or genuinely different rates of change. Module depth is subordinate to verified system constraints.
