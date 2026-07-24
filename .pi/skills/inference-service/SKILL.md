---
name: inference-service
description: Use when building, reviewing, or debugging inference service backends in TypeScript/JavaScript — covers request
  ingestion architecture, batching strategies, semantic caching, SSE streaming, circuit breakers, fallback chains, rate limiting,
  GPU observability, and graceful degradation. MUST load before designing inference service architecture or writing any inference-serving
  code.
metadata:
  version: 1.0.0
disable-model-invocation: true
---

# Inference Service (TS/JS)

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Decouple ingestion from inference.** Workers pull from a queue. Never push to a worker.
- **Don't embed the model in Node.js.** Use a separate inference engine (vLLM, TGI, llama.cpp server).
- **Let the engine batch.** Do not build your own batching layer; it will be worse.
- **Semantic cache, not hash cache.** Embeddings, not request fingerprints.
- **Circuit breaker, not try-catch.** Trip fast, fail loud, recover explicitly.
- **Degrade, don't fail.** Fallback chains for capacity errors, not 500s.
</EXTREMELY-IMPORTANT>

## Architecture

| Architecture | Crash | Backpressure | GPU |
|---|---|---|---|
| Monolith (Express + model in-process) | All inflight lost | Cascading | Poor |
| Worker thread isolation | Shared fate | 429 at capacity | Slightly better |
| Process pool, same host | Host failure | Slight | Good |
| **Persistent queue** (Redis Streams/NATS/Kafka) | **Zero loss** | **Natural drain** | **Best** |

**Queue contract:** workers pull when GPU is free; queued requests survive crashes; queue length is the autoscaling metric; dead-letter for permanent failures. Use Redis Streams (not simple lists).

## Engine Selection

- vLLM (Python, best throughput, OpenAI-compatible API)
- TGI (Rust/Hugging Face, good for production)
- llama.cpp server (C++, lightweight, GGUF models)
- Local Ollama (dev only)

Node.js side is a thin client: validate input, enqueue, stream response, never touch the model.

## Batching

Let the engine do it. Configure `max_num_seqs` / `max_batch_size` on the engine. Do not implement client-side batching — it starves GPU, breaks streaming.

## Semantic Caching

Embed prompts (small embedding model, e.g., `all-MiniLM-L6-v2`). Cache key = `(model_id, embedding)`. Threshold 0.95+ for hit. Avoid hashing identical prompts — paraphrases deserve the same cache slot.

## Streaming: SSE with Cancel

- `Content-Type: text/event-stream`, flush per token
- Respect `request.signal` (AbortController) — close conn, ack queue
- `stream_token_limit` per request to bound output cost
- Heartbeat comments every 15-30s to keep proxies alive

## Error Handling: Circuit Breaker

- 3 consecutive 5xx → OPEN
- Half-open after 30s, single probe
- On OPEN: 503 + `Retry-After`, fast
- DO NOT try-catch and retry the same call repeatedly

## Fallback Chains

- Primary model fails → smaller model (degraded quality, still works)
- All models fail → cached response (last known good for similar query)
- Cache miss → static fallback message + queue for async followup
- Never return 500 when a fallback is available

## Common Mistakes

Embedding model in Node.js; client-side batching; hash-based cache; no circuit breaker; no abort handling; no graceful shutdown; global rate limit; missing spans; cold-start optimism.

## Red Flags

Synchronous model calls; no queue; one retry on 5xx; streaming without backpressure; OOM on long contexts; crashes mid-stream without recovery; gateway-only rate limit; observability "later"; queue length not monitored.

## Anti-Patterns

"Single-process for simplicity" (loses all inflight on crash); "retry on timeout" (without backoff = thundering herd); "hash prompt for cache" (paraphrase-misses); "no abort handling" (zombie connections); "we'll add observability later" (you won't).
