---
name: performance-optimization
description: Use when profiling, optimizing, or adding performance budgets to applications — covers measure-first workflow, Core Web Vitals, common anti-patterns, and performance regression prevention
version: 1.0.0
tags: [performance, code-quality]
dependencies: []
---

# Performance Optimization

> **Replaces** premature optimization and gut-feeling tuning with measurement-driven improvements that target actual bottlenecks

## When to Use

- Application is measurably slow (user reports, metrics, profiler data)
- Setting up performance budgets for a new project
- Reviewing code for common performance anti-patterns
- Performance regression detected in CI or monitoring

## When NOT to Use

- No evidence of a performance problem — premature optimization wastes time
- Micro-optimizations that save nanoseconds in non-hot paths
- Choosing "fast" over "correct" — correctness first, always

## Overview

Performance optimization is an empirical process. Measure, identify, fix, verify. Never optimize without profiling first.

**Core principle:** Measure before optimizing. Optimize the bottleneck, not the code you happen to be reading. Verify the improvement with numbers.

## Measure-First Workflow

```
1. MEASURE   — Profile to identify actual bottlenecks (not guessed ones)
2. IDENTIFY  — Find the specific hot path or resource constraint
3. FIX       — Apply targeted optimization to the bottleneck
4. VERIFY    — Measure again to confirm improvement
5. GUARD     — Add budget/benchmark to prevent regression
```

**Rule:** Skip to step 3 only if you have measurement data that justifies the optimization.

## Performance Targets

### Core Web Vitals (Web)

| Metric                          | Good    | Needs Improvement | Poor    |
| ------------------------------- | ------- | ----------------- | ------- |
| LCP (Largest Contentful Paint)  | ≤ 2.5s  | ≤ 4.0s            | > 4.0s  |
| INP (Interaction to Next Paint) | ≤ 200ms | ≤ 500ms           | > 500ms |
| CLS (Cumulative Layout Shift)   | ≤ 0.1   | ≤ 0.25            | > 0.25  |

### General Targets

| Context             | Target       | Measure                |
| ------------------- | ------------ | ---------------------- |
| API response (p95)  | < 200ms      | Server-side timing     |
| CLI command startup | < 500ms      | `time` or `perf_hooks` |
| Build time          | < 60s        | CI pipeline metrics    |
| Bundle size (JS)    | < 200KB gzip | Bundler output         |
| Database query      | < 50ms       | Query EXPLAIN + timing |

## Common Anti-Patterns & Fixes

### N+1 Queries

```typescript
// ❌ N+1: One query per user
const users = await db.query("SELECT * FROM users");
for (const user of users) {
  user.posts = await db.query("SELECT * FROM posts WHERE user_id = ?", [user.id]);
}

// ✅ Batch: Two queries total
const users = await db.query("SELECT * FROM users");
const userIds = users.map((u) => u.id);
const posts = await db.query("SELECT * FROM posts WHERE user_id IN (?)", [userIds]);
// Group posts by user_id in application code
```

### Unbounded Fetching

```typescript
// ❌ Fetch everything
const allItems = await db.query("SELECT * FROM items");

// ✅ Paginate
const items = await db.query("SELECT * FROM items LIMIT ? OFFSET ?", [pageSize, offset]);
```

### Missing Memoization

```typescript
// ❌ Recompute on every render
function ExpensiveList({ items }) {
  const sorted = items.sort((a, b) => complexSort(a, b)); // sorts on every render
  return <List items={sorted} />;
}

// ✅ Memoize expensive computation
function ExpensiveList({ items }) {
  const sorted = useMemo(
    () => [...items].sort((a, b) => complexSort(a, b)),
    [items]
  );
  return <List items={sorted} />;
}
```

### Large Bundle Size

```typescript
// ❌ Import entire library
import _ from "lodash";
const result = _.debounce(fn, 300);

// ✅ Import only what you need
import debounce from "lodash/debounce";
const result = debounce(fn, 300);

// ✅✅ Use native (no dependency)
function debounce(fn, ms) {
  /* ... */
}
```

### Missing Image Optimization

```html
<!-- ❌ Unoptimized -->
<img src="hero.png" />

<!-- ✅ Optimized -->
<img
  src="hero.webp"
  srcset="hero-400.webp 400w, hero-800.webp 800w, hero-1200.webp 1200w"
  sizes="(max-width: 600px) 400px, (max-width: 1024px) 800px, 1200px"
  loading="lazy"
  decoding="async"
  width="1200"
  height="630"
  alt="Hero image"
/>
```

### Unnecessary Re-renders (React)

```typescript
// ❌ New object every render causes child re-render
function Parent() {
  return <Child style={{ color: 'red' }} onClick={() => doThing()} />;
}

// ✅ Stable references
const style = { color: 'red' };
function Parent() {
  const handleClick = useCallback(() => doThing(), []);
  return <Child style={style} onClick={handleClick} />;
}
```

## Profiling Tools

| Context          | Tool                             | What It Shows                     |
| ---------------- | -------------------------------- | --------------------------------- |
| Web (browser)    | Chrome DevTools Performance      | Paint, scripting, layout, network |
| Web (field data) | CrUX, PageSpeed Insights         | Real-user Core Web Vitals         |
| Node.js          | `node --prof` + `--prof-process` | V8 profiling ticks per function   |
| Node.js          | `clinic.js`                      | Flamegraphs, event loop delays    |
| React            | React DevTools Profiler          | Component render times            |
| SQL              | `EXPLAIN ANALYZE`                | Query execution plan              |
| Bundle           | `source-map-explorer`            | Module size breakdown             |
| Network          | `lighthouse`                     | Loading performance audit         |

## Performance Budget

### Setting Budgets

```json
{
  "budgets": [
    { "metric": "js-bundle", "max": "200KB", "warn": "150KB" },
    { "metric": "css-bundle", "max": "50KB", "warn": "40KB" },
    { "metric": "lcp", "max": "2500ms", "warn": "2000ms" },
    { "metric": "api-p95", "max": "200ms", "warn": "150ms" }
  ]
}
```

### Enforcing Budgets in CI

```yaml
- name: Check bundle size
  run: |
    npx bundlesize --config .bundlesizerc.json

- name: Lighthouse audit
  run: |
    npx lighthouse $URL --output json --chrome-flags="--headless"
    # Parse and assert against budgets
```

## Common Rationalizations

| Excuse                            | Rebuttal                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| "It's fast enough on my machine"  | Test on low-end devices and slow networks. Your machine isn't representative.      |
| "We'll optimize later"            | Performance debt compounds. Set budgets now, optimize when they're breached.       |
| "This micro-optimization matters" | Profile first. If it's not in the hot path, it doesn't matter.                     |
| "Users won't notice 200ms"        | Studies show 100ms delays reduce conversions. Users notice more than you think.    |
| "Adding metrics is overhead"      | The overhead of measurement is trivial compared to the cost of blind optimization. |
| "Caching will fix it"             | Caching masks problems. Fix the root cause, then add caching as defense.           |

## Red Flags — STOP

- Optimizing without profiling data
- Adding caching to mask a fundamentally slow operation
- Micro-optimizing code that runs once per request
- Bundle size growing without review
- No performance budget or monitoring in place
- Using `SELECT *` in production queries

## Verification

- [ ] Bottleneck identified with profiling data (not intuition)
- [ ] Optimization shows measurable improvement in profiler
- [ ] Performance budget is set and enforced in CI
- [ ] No regressions in existing benchmarks
- [ ] Optimization doesn't sacrifice correctness or readability

## See Also

- **react-best-practices** — React-specific performance patterns (server components, bundle optimization)
- **ci-cd-and-automation** — Enforcing performance budgets in CI
- **code-simplification** — Simplifying code often improves performance as a side effect
