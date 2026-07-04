---
name: deep-module-design
description: Use when designing modules, refactoring shallow structures, or reviewing AI-generated code for structural quality.
version: 1.0.0
tags: [architecture, code-quality, ousterhout]
dependencies: []
agent_types: [planner, worker, reviewer]
tools: [grep, find, read, bash]
---

# Deep Module Design

> Based on John Ousterhout's *A Philosophy of Software Design*

## Overview

A deep module has a **small interface relative to its implementation**. It provides significant functionality through a compact abstraction, hiding complexity from its callers. A shallow module has an **interface as complex as its implementation** — it wraps one small thing with ceremony, adding overhead without hiding anything.

**Why this matters for AI agents:** AI coding tools generate code faster than humans can review. Shallow modules compound this problem — every AI pass can produce more tiny, shallow abstractions that increase cognitive load without reducing complexity. Deep modules constrain the AI: a small, stable interface limits the blast radius of AI-generated changes and makes verification tractable.

> *"The most important technique for achieving deep modules is information hiding."* — Ousterhout

## When to Use

- Designing a new module, class, or API boundary
- Reviewing code for structural quality (beyond just correctness)
- Refactoring a codebase where changes are too expensive because interfaces are too complex
- Working with AI agents that need tight, stable interfaces to produce reliable code
- Any time you find yourself writing a class/method that just calls another class/method

## When NOT to Use

- Prototyping where the abstraction will change completely (use after stabilization)
- Tiny utility functions that are inherently single-purpose and shallow by nature
- Code that will be replaced within the sprint

## Core Concept: Deep vs Shallow

### Deep Module

```
┌─────────────────────────────────────┐
│       COMPLEX IMPLEMENTATION        │
│   (caching, retries, batching,      │
│    connection pooling, fallbacks)    │
│                                     │
│   ┌─────────────────────────────┐   │
│   │     SMALL INTERFACE         │   │
│   │   get(key), set(key, val)   │   │
│   └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

Example: Unix I/O (`open`, `read`, `write`, `close`). Five system calls hide filesystems, device drivers, disk scheduling, buffering, permissions, and network mounts. The interface has not changed in decades.

### Shallow Module

```
┌─────────────────────┐
│  SMALL IMPLEMENT.   │
│  (just wraps one    │
│   function call)    │
│                     │
│  ┌───────────────┐  │
│  │ COMPLEX IFACE │  │
│  │ many methods,  │  │
│  │ many config    │  │
│  │ options        │  │
│  └───────────────┘  │
└─────────────────────┘
```

Example: A "ParserFactory" that has one method `createParser(type)` which does a switch statement. The factory adds a class, an interface, and a registration mechanism — more surface area than the problem requires. Better to just call the parser directly or use a simple config object.

### Self-Test

Ask about ANY module you design or review:

> "Can I understand this module's interface in 30 seconds?"
> "Does the caller need to know implementation details to use it?"
> "Is this module's API surface area proportional to the complexity it hides?"

If the interface takes longer to learn than the implementation, the module is shallow — either deepen it or eliminate it.

## Design Principles

### 1. Information Hiding

The most important technique for achieving deep modules. Every implementation detail that callers don't need to know about should be private, internal, or abstracted away.

**Signs of information leakage:**
- Configuration that callers must set but relates to internal behavior (buffer sizes, retry counts, thread pool sizes)
- Methods that expose internal types (returning database rows, internal DTOs)
- Callers constructing complex intermediate objects before calling your API

**Fix:** Move the complexity inside. Default everything. Accept simple inputs.

### 2. Pull Complexity Downward

If a feature introduces complexity, handle it inside the module rather than pushing it to callers.

| ❌ Pushed to caller | ✅ Pulled downward |
|---|---|
| Caller must handle retries, timeouts, and fallbacks | Module handles them internally |
| Caller must format data correctly before passing | Module accepts raw data and transforms it |
| Caller must manage connection lifecycle | Module manages pools transparently |

> *"It is more important for a module to have a simple interface than a simple implementation."* — Ousterhout

### 3. General-Purpose vs Special-Purpose

General-purpose modules tend to be **deeper** because they solve a class of problems, not just one specific case. Special-purpose modules tend to be **shallower** because they're closely coupled to one use case.

**Rule of thumb:** Design modules to solve general problems. A "UserRepository" is deep (CRUD + queries for any user need). A "GetUserForLoginHandler" is shallow (only handles one specific query) — better to have a general `getUser` method and let callers filter as needed.

**Exception:** If the general-purpose interface would be significantly harder to understand, keep it special-purpose. Depth wins over generality.

### 4. Different Layer, Different Abstraction

Each layer of a system should provide a **different abstraction**. If two layers provide the same abstraction, one of them is redundant.

**Red flag — pass-through methods:**
```typescript
// Layer 2: Service layer
class UserService {
  constructor(private repo: UserRepository) {}

  // This is a pass-through — it adds nothing
  getUser(id: string) {
    return this.repo.findById(id);
  }
}
```

If a method does nothing except delegate with the exact same signature, it's a **pass-through method** — a sign the layer boundary is wrong. Either make the layer do something meaningful, or remove it.

**Red flag — pass-through variables:**
```typescript
// Top-level handler
function handleRequest(req, config) {
  return processRequest(req, config);
}

// Middle layer
function processRequest(req, config) {
  return executeQuery(req, config);
}

// Bottom layer
function executeQuery(req, config) {
  return db.query(req, config);
}
```

When the same variable (`config`) passes through multiple layers without being used by the middle layers, it's a **pass-through variable**. This couples all layers to the config shape. Fix: put config in a global context, or restructure so the middle layers don't need it.

## Red Flag Catalog

| Red Flag | What it looks like | Fix |
|---|---|---|
| **Shallow module** | Interface as complex as its implementation | Eliminate or merge into caller |
| **Information leakage** | One module exposes types another module depends on | Move the types to a shared neutral location or hide them |
| **Pass-through method** | Method just delegates with same signature | Remove the middle layer or make it add value |
| **Pass-through variable** | Same data flows through many layers unused | Use a context object or restructure |
| **Replicated code smell** | Same pattern appears across modules instead of once | Extract a deeper module that encapsulates the pattern |
| **Configuration pollution** | Callers must configure internal behavior (buffer sizes, timeouts) | Auto-detect or default everything |
| **Returning internal state** | API exposes DB rows, internal DTOs, or raw storage types | Map to public types at the boundary |
| **Temporal coupling** | Methods must be called in a specific order not enforced by types | Design so invalid states are unrepresentable |

## AI-Specific Applications

Deep modules are especially valuable for AI-generated code:

| Problem | Deep module solution |
|---|---|
| AI creates shallow wrappers every time it refactors | Eliminate or merge them — keep the abstraction layer count minimal |
| AI introduces pass-through methods when adding layers | Spot them in review and remove — they add surface area without depth |
| AI makes cascading changes because interfaces are too wide | Narrow interfaces — a small, stable surface limits blast radius |
| AI generates inconsistent implementations across similar operations | Create one deep general-purpose module the AI can reuse instead of reimplementing |
| AI hallucinates configuration options the module doesn't need | Remove configurability — deep modules default aggressively |

## Verification

- [ ] Every module's interface is easier to understand than its implementation
- [ ] No pass-through methods (methods that just delegate with same signature)
- [ ] No information leakage (callers don't depend on internal types)
- [ ] No configuration that should be internalized
- [ ] Different layers provide different abstractions
- [ ] AI agents could safely use this module without reading its implementation

## See Also

- **code-review-and-quality** — Assess for shallow modules and information leakage during review
- **api-and-interface-design** — Deep module principles applied to REST/API design
- **code-cleanup** — Consolidate shallow modules during cleanup passes

## Skill Result Contract

```xml
<skill_result>
  <skill>deep-module-design</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Modules assessed, red flags found or cleared, depth ratio evaluated</evidence>
  <artifacts>Files or modules reviewed/designed</artifacts>
  <risks>Known shallow modules deferred, or none</risks>
</skill_result>
```
