---
name: inference-service
description: Architecture patterns for TypeScript/JavaScript inference-serving backends — queue-based ingestion, engine-side batching, semantic caching, SSE streaming with cancel, circuit breakers, and fallback chains. User-invoked; load via /skill:inference-service when designing, reviewing, or debugging an LLM-serving backend such as vLLM, TGI, or llama.cpp behind Node.
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

Embed prompts (small embedding model, e.g., `all-MiniLM-L6-v2`). Cache key = `(model_id, embedding)`. Start the similarity threshold high (~0.95) and tune against real traffic — validate hits manually before loosening. Avoid hashing identical prompts — paraphrases deserve the same cache slot.

## Streaming: SSE with Cancel

- `Content-Type: text/event-stream`, flush per token
- Respect `request.signal` (AbortController) — close conn, ack queue
- `stream_token_limit` per request to bound output cost
- Heartbeat comments every 15-30s to keep proxies alive

## Error Handling: Circuit Breaker

- Consecutive 5xx (e.g., 3) → OPEN; tune thresholds per service
- Half-open after a cooldown (e.g., 30s), single probe
- On OPEN: 503 + `Retry-After`, fast
- DO NOT try-catch and retry the same call repeatedly

## Fallback Chains

- Primary model fails → smaller model (degraded quality, still works)
- All models fail → cached response (last known good for similar query)
- Cache miss → static fallback message + queue for async followup
- Never return 500 when a fallback is available

## Red Flags

Model embedded in Node.js; synchronous model calls; no queue ("single process for simplicity" loses all inflight on crash); client-side batching; hash-based cache (paraphrase misses); no circuit breaker — retrying timeouts without backoff is a thundering herd; streaming without backpressure or abort handling (zombie connections); crashes mid-stream without recovery; no graceful shutdown; gateway-only/global rate limit; queue length not monitored; "we'll add observability later" (you won't); cold-start optimism.
