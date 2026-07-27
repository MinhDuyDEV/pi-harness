---
name: observability-and-instrumentation
description: Instruments code with structured logs, RED/USE metrics, traces, and error tracking. Use when shipping endpoints, jobs, retries, queues, or external calls, or when a PR adds I/O with no telemetry.
metadata:
  version: 1.0.0
  tags:
  - devops
  - shipping
  dependencies: []
---

# Observability and Instrumentation

## Core Principle

Code you can't observe is code you can't operate. Instrument while building.

For performance, read `references/performance.md` and require a numeric
baseline plus re-measurement.

## When to Use

Any production-bound feature; new endpoints, background jobs, retries, queues, external integrations; after an incident where diagnosis lacked data; reviewing a PR that adds I/O. NOT for live debugging (`debugging-and-error-recovery`) or motion-specific rendering work (`fixing-motion-performance`).

## Start With Questions

Before adding any signal, write 2–4 questions the on-call engineer will ask ("what fraction of payments succeed on first attempt?", "when they fail permanently, why?"). Every signal must answer one. This prevents logging everything and learning nothing.

## Pick the Signal

| Signal | Answers | Cost |
|---|---|---|
| Structured log | "why did this happen?" | per event, scales with traffic |
| Metric | "how often / how fast, in aggregate?" | fixed per series |
| Trace | "where did the time go across services?" | per request, sampled |

Metrics show *that* something failed, traces show *where*, logs explain *why*.

## Structured Logging

JSON objects with stable event names and queryable fields — never string interpolation:

```ts
logger.warn({ event: "payment_failed", paymentId, provider, errorCode: err.code, attempt }, "payment failed");
```

Levels: `error` = invariant broken, investigate; `warn` = degraded but handled, watch the trend; `info` = significant business event; `debug` = off in production.

**Correlation IDs**: accept or generate a request ID at every system boundary; attach it to every log line, span, and outbound call — otherwise interleaved logs cannot reconstruct a request.

**Never log secrets, tokens, or PII.** Allowlist fields; never dump whole request bodies.

**No logging in hot loops.** A movement log flushed every frame once filled an SSD. Per-frame, per-tick, per-row events belong in a metric (counter, histogram) or behind sampling/rate-limiting — never unconditional.

## Metrics

- **RED** (rate, errors, duration) on every endpoint and external dependency; **USE** (utilization, saturation, errors) on resources like queues and pools.
- Latency as histogram; query p95/p99 — averages hide the suffering 1%.
- Bounded cardinality: labels come from small fixed sets (route template, status class, provider). Never user IDs, raw URLs, or error text — each unique combination is a new time series.

## Tracing and Errors

Use OpenTelemetry auto-instrumentation; add manual spans around meaningful internal units. Propagate context across every async boundary (HTTP headers, queue metadata) or traces fragment. Sample low by default; keep 100% of errors when the backend supports it. Route unhandled errors to tracking with release and requestId attached.

## Verify the Telemetry

Instrumentation is code; it fails too. Force an error in staging and locate it by requestId using telemetry alone. Send test traffic and confirm metric series appear with expected labels. Follow one request end-to-end in the trace UI with no broken spans.

## Common Rationalizations

| Excuse | Counter |
|---|---|
| "I'll add logging after it works" | Post-launch discovery is the costliest moment. |
| "More logs = more observability" | Three queryable events beat 300 prose lines. |
| "console.log is fine for now" | Can't filter, correlate, or alert. Structured costs five minutes. |
| "User ID as metric label helps debugging" | Cardinality bomb. User-level queries live in logs and traces. |

## Red Flags

A PR adding retries, queues, or external calls with zero new telemetry; log lines built by string interpolation; no correlation IDs; latency tracked only as an average; a log statement inside a per-frame or per-row loop; secrets or full request bodies in logs; "works on my machine" as the production evidence.
