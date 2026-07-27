# Measure-first performance

Performance work needs a number, baseline, bottleneck, one isolated change, and
re-measurement. “Feels faster” is not evidence.

1. Set a target (for example p99 < 200ms, LCP < 2.5s, INP < 200ms, CLS < 0.1,
   TTFB < 800ms).
2. Capture a profile/trace and record the baseline.
3. State a testable bottleneck hypothesis.
4. Make one smallest change, preserving correctness.
5. Re-measure against the same workload; keep only a demonstrated improvement.
6. Add a regression benchmark or alert, then repeat if needed.

Use DevTools/Lighthouse for web, React Profiler for renders, `node --prof` or
flame graphs for Node, and `EXPLAIN ANALYZE` for database work. Check algorithmic
complexity, N+1 queries, sync I/O, bundle size, waterfalls, layout thrashing,
pool saturation, and cache invalidation before micro-optimizing.

