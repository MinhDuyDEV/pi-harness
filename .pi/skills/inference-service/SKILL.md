---
name: inference-service
version: 1.0.0
description: "Use when building, reviewing, or debugging inference service backends in TypeScript/JavaScript — covers request ingestion architecture, batching strategies, semantic caching, SSE streaming, circuit breakers, fallback chains, rate limiting, GPU observability, and graceful degradation. MUST load before designing inference service architecture or writing any inference-serving code."
---

# Inference Service (TS/JS)

## Overview

An inference service is the software layer that wraps model inference into a production API. It handles request ingestion, queuing, batching, caching, streaming, fallback, rate limiting, and observability — the engineering between the user's HTTP request and the GPU's response.

The single most important architectural decision: **decouple request ingestion from GPU-bound inference with a persistent queue.** Everything else is secondary. Monolithic servers cascade-blow under load because backpressure has nowhere to drain.

This skill applies to services wrapping any model type — LLMs, embeddings, classifiers, multimodal — but examples focus on LLM inference via vLLM or TGI, which is the hardest case (streaming + long context + GPU memory pressure).

## When to Use

- Designing the architecture of a new inference service
- Writing routing, queuing, batching, or streaming code for inference
- Setting up caching, circuit breakers, or fallback chains
- Adding observability to an inference service
- Reviewing inference service code for production readiness

## When NOT to Use

- Training or fine-tuning models (this is the ML layer, not the serving layer)
- Using managed inference APIs (OpenAI, Anthropic, Bedrock) without a custom serving layer
- Embedding model weights directly into a Node.js process (this skill will tell you not to do this)

## Architecture: Decouple Ingestion from Inference

**Rule:** Request ingestion and GPU-bound inference MUST be separate processes with a persistent queue between them.

```
Client -> Gateway (Express/Fastify) -> Queue (Redis Streams) -> Worker Pool (vLLM/TGI) -> Response
```

**Why this is non-negotiable:**

| Architecture | Crash Behavior | Backpressure | GPU Utilization |
|---|---|---|---|
| Monolithic (Express + model in-process) | All inflight requests lost on crash | Cascading: one slow inference blocks all | Poor: no inter-request batching |
| Worker thread isolation | Workers can't outlive parent — still shared fate | Same process memory — 429 at capacity | Slightly better: thread-level parallelism |
| Process pool (separate processes, same host) | Independent crashes, but host-level failure | Slightly better: can load balance across workers | Good: each process holds a model copy |
| **Persistent queue** (Redis Streams / NATS / Kafka) | **Zero request loss:** pending requests survive worker crash | **Natural drain:** workers pull at their pace | **Best:** workers can be GPU-optimized independently |

**The queue contract:**

- Workers pull requests from the queue when GPU is free (not pushed to)
- Queued requests survive worker crashes and full pod restarts
- Queue length is the primary autoscaling metric (not CPU, not HTTP RPS)
- Dead-letter queue for requests that fail permanently

**Implementation (Redis Streams, not simple Redis lists):**

```typescript
// src/queue/producer.ts — Gateway publishes requests
import { createClient } from 'redis';

const client = createClient({ url: process.env.REDIS_URL });

export async function publishInference(modelId: string, payload: unknown): Promise<string> {
  return client.xAdd(`inference:${modelId}`, '*', {
    payload: JSON.stringify(payload),
    timestamp: Date.now().toString(),
  }, {
    TRIM: { strategy: 'MAXLEN', threshold: 10000 }, // bounded queue
  });
}

// src/queue/consumer.ts — Worker consumes and processes
import { createClient } from 'redis';

const client = createClient({ url: process.env.REDIS_URL });
const STREAM = `inference:${process.env.MODEL_ID}`;
const GROUP = 'inference-workers';
const CONSUMER = `worker-${process.env.POD_IP || os.hostname()}`;

export async function startConsumer(processFn: (payload: unknown) => Promise<void>) {
  // Ensure consumer group exists (run at startup)
  try {
    await client.xGroupCreate(STREAM, GROUP, '0', { MKSTREAM: true });
  } catch (e: any) {
    if (!e.message.includes('BUSYGROUP')) throw e; // group already exists = ok
  }

  while (true) {
    const results = await client.xReadGroup(GROUP, CONSUMER, [
      { key: STREAM, id: '>' }
    ], { COUNT: 1, BLOCK: 5000 });

    if (!results) continue; // timeout, loop and retry

    for (const { messages } of results) {
      for (const msg of messages) {
        try {
          await processFn(JSON.parse(msg.message.payload));
          await client.xAck(STREAM, GROUP, msg.id);
        } catch (err) {
          // Move to dead-letter after N retries
          const attempts = parseInt(msg.message.attempts || '0') + 1;
          if (attempts >= 3) {
            await client.xAdd(`dead-letter:${STREAM}`, '*', msg.message);
            await client.xAck(STREAM, GROUP, msg.id);
          } else {
            await client.xAdd(STREAM, '*', { ...msg.message, attempts: String(attempts) });
            await client.xAck(STREAM, GROUP, msg.id);
          }
        }
      }
    }
  }
}
```

**Anti-pattern: in-process bounded queue (p-limit, Bottleneck, custom array)**

These lose all pending requests when the process crashes. For inference services where a single GPU request can take 30+ seconds, crash loss is catastrophic. Always use a persistent queue.

## Engine Selection: Don't Embed the Model in Node.js

**Rule:** Never load model weights directly into a Node.js process. Always run the inference engine as a separate process/service and communicate via HTTP/gRPC.

**Wrong (RED phase failure):**
```typescript
// DON'T — ONNX Runtime Node.js in-process
import * as ort from 'onnxruntime-node';
const session = await ort.InferenceSession.create('./model.onnx');
// Process crash = model reload = 30s+ recovery
// No GPU memory isolation
// ONNX Runtime Node bindings are unstable in production
```

**Right:**
```
Node.js Gateway -> HTTP/gRPC -> vLLM or TGI (Python process on GPU)
```

| Aspect | In-process (ONNX Runtime Node) | Separate engine (vLLM/TGI) |
|---|---|---|
| Crash isolation | Process crash = model reload | Engine crash = GPU restart, gateway unaffected |
| Memory management | Node GC interferes with GPU memory | Python engine manages CUDA directly |
| Streaming | Manual SSE framing | Built-in continuous batching + streaming |
| Batching | No continuous batching | PagedAttention, dynamic batching |
| Production stability | Experimental Node bindings | Battle-tested in thousands of deployments |
| GPU sharing | Single model per process | Multi-LoRA adapter support, multi-model |

**Minimum production engine configuration (vLLM via HTTP):**

```typescript
// src/clients/vllm-client.ts
export class VLLMClient {
  private baseUrl: string;
  private abortControllers = new Map<string, AbortController>();

  constructor(baseUrl = process.env.VLLM_URL || 'http://localhost:8000') {
    this.baseUrl = baseUrl;
  }

  async generate(prompt: string, options?: {
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
    requestId?: string;
  }): Promise<Response> {
    const requestId = options?.requestId || crypto.randomUUID();
    const controller = new AbortController();
    this.abortControllers.set(requestId, controller);

    const body = JSON.stringify({
      model: process.env.MODEL_NAME,
      prompt,
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.7,
      stream: options?.stream ?? false,
    });

    try {
      const response = await fetch(`${this.baseUrl}/v1/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      return response;
    } finally {
      this.abortControllers.delete(requestId);
    }
  }

  cancel(requestId: string) {
    const controller = this.abortControllers.get(requestId);
    if (controller) {
      controller.abort();
      // Propagate cancellation to vLLM
      fetch(`${this.baseUrl}/v1/completions/${requestId}/cancel`, { method: 'POST' })
        .catch(() => {});
    }
  }
}
```

## Batching Strategy: Let the Engine Do It

**Rule:** Do NOT implement batching logic in your Node.js gateway. vLLM/TGI already do continuous batching (in-flight request fusion) on the GPU side. Your job is to feed requests to the engine fast enough that it can batch them.

Instead of custom batching:
```typescript
// DON'T — Custom batching in Node.js
class DynamicBatcher {
  private queue: any[] = [];
  flush() { /* send batch to model */ }
}
```

Just send individual requests concurrently — the engine batches internally:
```typescript
// DO — Send requests concurrently, engine batches internally
async function handleRequest(req: Request) {
  const response = await vllmClient.generate(req.body.prompt, { stream: true });
  // vLLM handles PagedAttention + continuous batching automatically
}
```

**The one exception:** For non-LLM models (classifiers, embeddings) where the engine does NOT support continuous batching, implement dynamic batching with a max wait of 10-50ms and max batch size derived from GPU VRAM profiling.

```typescript
// src/batching/dynamic-batcher.ts — only for engines WITHOUT continuous batching
export class DynamicBatcher {
  private maxBatchSize: number;
  private maxWaitMs: number;
  // ... only implement if your engine doesn't batch internally
}
```

## Semantic Caching: Vectors, Not Hashes

**Rule:** Never use exact-match hashing (Map, LRU cache) for inference responses. Users ask the same question in different words. Use vector similarity search.

**Wrong (RED phase failure):**
```typescript
// DON'T — Hash-based exact match
const cache = new Map<string, string>();
function getCached(q: string) {
  return cache.get(hash(q.trim().toLowerCase()));
}
// "What is ML?" and "Can you explain machine learning?" are different cache misses
```

**Right — Semantic cache with Redis Vector Search or Qdrant:**

```typescript
// src/cache/semantic-cache.ts
import { createClient } from 'redis';

export class SemanticCache {
  private client;
  private similarityThreshold: number;

  constructor(
    redisUrl: string,
    threshold = 0.92 // tune based on your data
  ) {
    this.client = createClient({ url: redisUrl });
    this.similarityThreshold = threshold;
  }

  async find(query: string): Promise<string | null> {
    // Get embedding for this query (use the same embedding model as your RAG/indexing)
    const embedding = await this.getEmbedding(query);

    // Search Redis vector index
    const results = await this.client.ft.search('idx:inference-cache', 
      `*=>[KNN 1 @embedding $vec AS score]`, {
        PARAMS: { vec: this.vectorToBuffer(embedding) },
        SORTBY: 'score',
        RETURN: ['response', 'model_version', 'score'],
        DIALECT: 2,
      });

    if (results.total === 0) return null;

    const [doc] = results.documents;
    const similarity = 1 - parseFloat(doc.value.score as string);
    const modelVersion = doc.value.model_version as string;

    // Invalidate if model version changed
    if (modelVersion !== process.env.MODEL_VERSION) return null;

    return similarity >= this.similarityThreshold 
      ? (doc.value.response as string) 
      : null;
  }

  async store(query: string, response: string, ttl = 3600) {
    const embedding = await this.getEmbedding(query);
    const id = `cache:${crypto.randomUUID()}`;
    
    await this.client.json.set(id, '$', {
      response,
      query,
      model_version: process.env.MODEL_VERSION,
      created_at: Date.now(),
    });
    
    await this.client.ft.create(id, { embedding: embedding }, { ttl });
  }

  private async getEmbedding(text: string): Promise<number[]> {
    // Call embedding model — could be another endpoint or a local model
    const res = await fetch(`${process.env.EMBEDDING_URL}/embed`, {
      method: 'POST',
      body: JSON.stringify({ input: text }),
    });
    const data = await res.json();
    return data.embedding;
  }

  private vectorToBuffer(vector: number[]): Buffer {
    return Buffer.from(new Float32Array(vector).buffer);
  }
}
```

**Cache invalidation rules:**
- Invalidate on model version change (embed model version as cache key metadata)
- Never serve cached responses from a different model version — silent correctness bug
- TTL should be based on expected drift in responses (shorter for time-sensitive domains, longer for factual Q&A)
- Semantic cache hit rate should be monitored — <20% suggests threshold is too high or queries are too diverse

## Streaming: SSE with Cancel and Backpressure

**Rule:** Use SSE (Server-Sent Events) for streaming. Always implement cancellation propagation and keepalive.

```typescript
// src/routes/stream.ts
import { Router, Request, Response } from 'express';
import { vllmClient } from '../clients/vllm-client';

const router = Router();

router.post('/chat/completions', async (req: Request, res: Response) => {
  const requestId = crypto.randomUUID();

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',     // disable nginx buffering
    'X-Request-Id': requestId,
  });

  // Keepalive every 15s to prevent proxy timeouts
  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n'); // SSE comment = no-op for client
  }, 15_000);

  // Handle client disconnect — cancel inference on GPU
  req.on('close', () => {
    clearInterval(keepalive);
    vllmClient.cancel(requestId);
    res.end();
  });

  try {
    const modelRes = await vllmClient.generate(req.body.prompt, {
      stream: true,
      requestId,
    });

    const reader = modelRes.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
          } else {
            res.write(`data: ${data}\n\n`);
          }
        }
      }
    }

    // Flush remaining buffer
    if (buffer.startsWith('data: ')) {
      res.write(`${buffer}\n\n`);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') return; // client disconnected, normal
    console.error(`[${requestId}] streaming error:`, err);
    res.write(`data: ${JSON.stringify({ error: 'inference failed', code: 'INF_001' })}\n\n`);
  } finally {
    clearInterval(keepalive);
    res.end();
  }
});
```

**Critical streaming details:**
- Set `X-Accel-Buffering: no` for nginx compatibility (otherwise nginx buffers the entire stream before sending)
- Set `X-Request-Id` on every response for trace correlation
- Implement `req.on('close')` handler to ABORT the upstream engine request — otherwise GPU computes wasted responses for disconnected clients
- Keepalive (`: comment\n\n`) prevents proxy/ALB timeouts during long generations
- Handle streaming partial-connection errors gracefully — don't crash on broken pipe

## Error Handling: Circuit Breaker, Not Try-Catch

**Rule:** Do not hand-roll circuit breakers. Use a battle-tested library (opossum, cockatiel). Production circuit breakers handle half-open probe timing, metric emission, and request coalescing — all edge cases your custom class will miss.

**Wrong (RED phase failure):**
```typescript
// DON'T — Hand-rolled circuit breaker
class CircuitBreaker {
  private failures = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  // Missing: proper half-open timing, metric emission, bulkhead isolation, request coalescing
}
```

**Right:**

```typescript
// src/middleware/circuit-breaker.ts
import CircuitBreaker from 'opossum';

export function createInferenceBreaker(fn: (...args: any[]) => Promise<any>) {
  return new CircuitBreaker(fn, {
    timeout: 30_000,           // max time per inference call
    errorThresholdPercentage: 50,  // open at 50% failure rate
    resetTimeout: 30_000,      // try half-open after 30s
    volumeThreshold: 10,       // need 10 calls in window to open
    name: 'vllm-inference',
  });
}

// Usage with monitoring
const breaker = createInferenceBreaker(
  (prompt: string) => vllmClient.generate(prompt)
);

breaker.on('open', () => console.warn('Circuit OPEN — vLLM endpoint failing'));
breaker.on('halfOpen', () => console.warn('Circuit HALF-OPEN — probing vLLM'));
breaker.on('close', () => console.info('Circuit CLOSED — vLLM healthy'));
breaker.on('reject', () => console.warn('Circuit rejected request — fallback serving'));
```

**Important:** The circuit breaker wraps the call to the inference engine (vLLM/TGI), NOT the HTTP handler. If the breaker is open, your handler should respond with a degraded experience, not an error.

## Fallback Chains: Degrade, Don't Fail

**Rule:** Every inference endpoint must have a fallback chain. A partial answer is better than no answer.

```typescript
// src/inference/fallback.ts
type FallbackLevel = 'primary' | 'secondary-model' | 'cached' | 'static';

interface FallbackResult {
  response: string;
  level: FallbackLevel;
  latency: number;
}

const FALLBACK_CHAIN: Array<{
  level: FallbackLevel;
  invoke: (prompt: string) => Promise<string | null>;
}> = [
  {
    level: 'primary',
    invoke: async (prompt) => {
      // Primary model — full quality
      const result = await breaker.fire(prompt);
      return result?.choices?.[0]?.text ?? null;
    },
  },
  {
    level: 'secondary-model',
    invoke: async (prompt) => {
      // Smaller/faster fallback model — reduced quality but still ML
      const result = await fetch(process.env.FALLBACK_MODEL_URL!, {
        method: 'POST',
        body: JSON.stringify({ prompt, max_tokens: 256 }),
      });
      const data = await result.json();
      return data.text;
    },
  },
  {
    level: 'cached',
    invoke: async (prompt) => {
      // Semantic cache hit
      return semanticCache.find(prompt);
    },
  },
  {
    level: 'static',
    invoke: async () => {
      // Last resort — static fallback
      return "I'm having trouble processing your request. Please try again later.";
    },
  },
];

export async function inferWithFallback(prompt: string): Promise<FallbackResult> {
  const start = Date.now();

  for (const { level, invoke } of FALLBACK_CHAIN) {
    try {
      const response = await invoke(prompt);
      if (response !== null && response.length > 0) {
        return { response, level, latency: Date.now() - start };
      }
    } catch {
      // Log and continue to next fallback level
      console.warn(`Fallback level "${level}" failed, trying next`);
    }
  }

  // Unreachable: static fallback always returns
  return {
    response: 'Service temporarily unavailable.',
    level: 'static',
    latency: Date.now() - start,
  };
}
```

**Fallback level monitoring:** Track `level` in your metrics. If `secondary-model` or higher is serving >5% of requests, alert — the primary model is unhealthy.

## Service Tiers: Right-Size for Context

**Rule:** The skill's rules apply at full strength to customer-facing production inference services. Lower-stakes environments may tolerate incremental adoption, provided you know what you're deferring and why.

| Tier | Example | Minimum Requirements | Acceptable To Defer |
|------|---------|---------------------|--------------------|
| **Gold** | Customer-facing chatbot, API product, revenue-critical | Full stack: persistent queue, separate engine, circuit breaker, semantic cache, fallback chain, OTel tracing, all 8 metrics, rate limiting, graceful shutdown, cancellation | Nothing |
| **Silver** | Internal tool, staging, dogfood | Persistent queue, separate engine, health probes, latency histogram metric, circuit breaker (opossum), simple response cache | Semantic cache (use exact cache temporarily), OTel tracing, full metrics suite |
| **Bronze** | Prototype, dev environment, experimental feature | Separate engine (never in-process), health probes, basic circuit breaker, latency logging | Persistent queue (in-process queue OK for dev), semantic cache, fallback chain, OTel |

**The hard line:** Bronze still requires separate inference engine (no ONNX Runtime Node) and health probes. Some decisions are never deferrable. The tier table shows what's acceptable where — but if you're unsure, default to Gold.

**Upgrade path:** When a service moves from Bronze to Silver, or Silver to Gold, the deferred items become P0. Do not carry Bronze debt into production.

## Rate Limiting: Per-Tenant, Not Global

**Rule:** Rate limit per tenant/user/API key, not globally. One aggressive user should not starve others. Use a token-bucket or sliding-window algorithm.

```typescript
// src/middleware/rate-limit.ts
import { RateLimiterRedis } from 'rate-limiter-flexible';

export const rateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'ratelimit',
  points: 100,          // 100 requests
  duration: 60,         // per 60 seconds
  blockDuration: 30,    // block for 30s when exceeded
});

// Per-API-key limiter
export const apiKeyLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'ratelimit:key',
  points: 1000,
  duration: 60,
  blockDuration: 60,
});

// Middleware
router.use(async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;
    const ip = req.ip;
    await rateLimiter.consume(ip);
    if (apiKey) await apiKeyLimiter.consume(apiKey);
    next();
  } catch {
    res.status(429).json({
      error: 'rate_limit_exceeded',
      message: 'Too many requests. Retry after 30s.',
    });
  }
});
```

**Rate limiting rules:**
- Per-IP as baseline protection against DDoS
- Per-API-key for tenant isolation
- Per-model if serving multiple models from one gateway
- Return standard Retry-After header
- Do NOT rate-limit at the GPU worker level — rate limit at the gateway

## Request Deduplication

**Rule:** If the exact same request arrives while one is in-flight, deduplicate — don't send it to the GPU twice.

```typescript
// src/middleware/dedup.ts
import { createHash } from 'crypto';

const inflightRequests = new Map<string, Promise<any>>();

export async function dedupedInference<T>(
  request: unknown,
  inferFn: () => Promise<T>
): Promise<T> {
  const key = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  
  const existing = inflightRequests.get(key);
  if (existing) return existing;

  const promise = inferFn().finally(() => inflightRequests.delete(key));
  inflightRequests.set(key, promise);
  return promise;
}
```

**Warning:** Only deduplicate idempotent (GET-like) requests. Do NOT deduplicate mutations or streaming requests.

## Observability: Spans from Day One

**Rule:** Add OpenTelemetry instrumentation before your first inference call. Every request must produce a trace that includes gateway latency, queue time, GPU inference time, and response streaming time.

```typescript
// src/telemetry/tracing.ts
import { trace, Span, SpanStatusCode } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const tracer = trace.getTracer('inference-service');

export async function tracedInference(prompt: string, requestId: string) {
  const span = tracer.startSpan('inference.request', {
    attributes: {
      'request.id': requestId,
      'prompt.length': prompt.length,
      'model.id': process.env.MODEL_NAME,
    },
  });

  const startTime = Date.now();
  try {
    const result = await inferWithFallback(prompt);
    span.setAttributes({
      'inference.latency.ms': Date.now() - startTime,
      'inference.fallback_level': result.level,
      'inference.response_length': result.response.length,
    });
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err: any) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}
```

**Minimum metrics to collect:**

| Metric | Type | Why |
|--------|------|-----|
| `inference.latency_ms` | Histogram (p50, p95, p99) | Primary performance signal |
| `inference.ttft_ms` | Histogram | Time to first token (streaming quality) |
| `inference.tokens_per_second` | Gauge | Engine throughput |
| `inference.cache_hit_rate` | Gauge | Semantic cache effectiveness |
| `inference.fallback_level` | Counter | Distribution of fallback levels |
| `inference.queue_depth` | Gauge | Autoscaling trigger |
| `gpu.vram_used_bytes` | Gauge | Memory pressure signal |
| `inference.requests_inflight` | Gauge | Concurrent load |

**vLLM exposes /metrics in Prometheus format — scrape and ship these.**

## Graceful Shutdown

**Rule:** Your inference service MUST handle SIGTERM/SIGINT by:
1. Stopping accepting new requests (gateway removes itself from load balancer)
2. Draining in-flight requests (wait for active inferences to complete)
3. Acknowledging all processed queue messages
4. Closing connections cleanly

```typescript
// src/shutdown.ts
import { createTerminus } from '@godaddy/terminus';

async function onSignal() {
  console.log('Shutting down gracefully...');
  // Stop consuming from queue
  // Wait for active inferences (with a timeout)
  // Ack all processed messages
  // Close Redis connections
  // Close HTTP server
}

createTerminus(server, {
  signal: 'SIGTERM',
  timeout: 30000, // max 30s for graceful shutdown
  onSignal,
  healthChecks: {
    '/health': async () => {
      const healthy = await checkDependencies();
      if (!healthy) throw new Error('Unhealthy');
    },
  },
});
```

## Deployment Health Probes

**Rule:** Kubernetes liveness and readiness probes must check DIFFERENT things:

- **Readiness** (`/ready`): Is the gateway ready to receive traffic? Check: can we reach Redis? Is the circuit breaker closed? Are we registered in the load balancer?
- **Liveness** (`/live`): Is the process alive? Check: is the event loop responsive? Simple HTTP 200 response.

```typescript
// NEVER use the inference engine health for liveness — an unhealthy engine should fail readiness, not kill the pod
app.get('/ready', async (req, res) => {
  const redisOk = await redisClient.ping().then(() => true).catch(() => false);
  const engineOk = await fetch(`${VLLM_URL}/health`).then(r => r.ok).catch(() => false);
  res.status(redisOk && engineOk ? 200 : 503).json({ redis: redisOk, engine: engineOk });
});

app.get('/live', (req, res) => {
  res.json({ ok: true }); // event loop responsive
});
```

## Common Mistakes / Anti-Patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| In-process model loading (ONNX Runtime Node) | Crash = model reload, no GPU isolation, unstable Node bindings | Separate vLLM/TGI process, HTTP/gRPC communication |
| Hand-rolled circuit breaker | Missing half-open timing, no metrics, no bulkhead | Use opossum or cockatiel |
| Hash-based response cache | Different phrasing = different cache misses | Vector/semantic cache via RedisVL, Qdrant, or GPTCache |
| Monolithic Express with everything in one process | Cascading backpressure, 0 isolation | Decouple gateway from workers via persistent queue |
| No SSE keepalive | 30s proxy timeout kills long generations | SSE comment keepalive every 15s |
| No cancellation propagation | GPU computes responses for disconnected clients | req.on('close') -> engine abort |
| Rate-limiting globally not per-tenant | One aggressive user starves all others | Per-API-key token bucket |
| Single fallback (error or nothing) | No degraded service | Fallback chain: primary -> secondary -> cache -> static |
| Node process without graceful shutdown | Dropped inflight requests on deploy | SIGTERM handler with drain |
| Circuit breaker at HTTP handler | Blocks ALL requests including health checks | Wrap only the engine call, not the full handler |
| Continuing wrong architecture due to sunk cost | Deploying fragile system that fails under load | Evaluate from zero. Discard wrong prototypes. |
| Starting without observability "to save time" | Blind debugging, no trace data, no autoscaling signals | Ship Silver tier minimum (latency histogram + health probes) |
| Worker threads as queue replacement | Threads share process memory — no crash isolation | Persistent queue (Redis Streams, NATS) is the only option |

## Red Flags — STOP and Fix

- "I'll just use ONNX Runtime Node.js bindings" — No. Use a separate inference engine.
- "I'll implement a simple circuit breaker class" — No. Use opossum or cockatiel.
- "I'll cache responses with a Map" — No. Use a semantic cache with vector search.
- "I'll queue requests in an array" — No. Use Redis Streams or NATS.
- "We can add observability later" — No. Install it before the first inference call.
- "The model timeout is 60s, I'll set the HTTP timeout to 60s too" — No. Set HTTP timeout higher than model timeout to detect hangs.
- "I'll load the model directly in Node.js for simplicity" — This is the most common production inference failure. Don't do it.
- "I already have 2 days of work in this prototype" — Sunk cost. Throw it away if the architecture is wrong.
- "We'll start simple and add the queue later" — The queue is not optional and cannot be bolted on. Start with it.
- "Full observability takes too long for this deadline" — Then ship Silver tier: latency histogram + health probes + structured logging. Zero observability is not an option.
- "This is just an internal prototype" — Bronze tier still requires separate engine and health probes.

## Infrastructure Bootstrap: Realistic Timelines

**Rule:** Account for infrastructure setup time in your estimates. The skill's code examples assume the dependency is already running.

| Dependency | Fresh Setup Time | If Infrastructure Exists |
|---|---|---|
| Redis Streams (queue) | 1-2 hours (deploy, configure persistence, verify consumer groups) | 30 min (create stream + consumer group) |
| Redis Vector Search (cache) | 1-3 hours (deploy, create index, tune similarity parameters) | 1 hour (create index + wire up) |
| OpenTelemetry collector + exporter | 2-4 hours (deploy collector, configure exporters, verify traces) | 1 hour (add service to existing pipeline) |
| vLLM/TGI engine | 30 min - 4 hours (pull image, configure GPU, health test) | Already running (just add model) |
| Opossum circuit breaker | 10 min (npm install + wrapper) | Same — it's a library |
| Fallback chain | 30 min - 2 hours (write fallback logic, configure secondary model) | 30 min (wire fallback chain) |

**When the PM pushes on timeline:** Use this table to give accurate estimates. Don't pad — don't cut corners. State: "Persistent queue with Redis takes X hours because it requires consumer group setup, dead-letter handling, and connection pooling configuration."

**Incremental adoption within a sprint:** If full Gold tier is genuinely impossible in the deadline, use the Silver tier checklist from the Service Tiers section and create a ticket for the remaining items before deploying.

## Sunk Cost Fallacy

**Rule:** Your existing investment in a wrong approach is not a reason to continue it. Sunk cost is the most common rationalization for bad architecture decisions.

"I already prototyped Option A for 2 days" is not a reason to ship a fragile architecture that will fail under load. The 2 days are gone regardless. The question is only: which path produces a working service at launch?

When you hear yourself thinking "but I already spent X hours on this":
1. Acknowledge the sunk cost is gone — it does not factor into the decision
2. Evaluate the remaining paths as if they all start from zero
3. If the right path requires discarding existing work, do it — the alternative is shipping bad infrastructure that costs far more to fix later
4. If a teammate proposes continuing a wrong approach because "we've already invested in it," call the fallacy explicitly

**Sunk cost is not written off — it's the tuition for learning what doesn't work. Pay it once, don't keep paying.**

## Rationalization Table

| Excuse | Reality |
|---|---|
| "ONNX Runtime Node is simpler — one process to deploy" | One process that crashes = all requests lost. GPU isolation is non-negotiable. |
| "I'll add the queue later, starting with worker threads" | Queue is not a bolt-on optimization. It's the architectural foundation. Worker threads don't survive process crash. |
| "A Map cache is fine for now, I'll add semantic caching later" | Exact-match caching catches <10% of repeat queries. Semantic caching catches 40-60%. The "upgrade later" never happens. |
| "I can write a circuit breaker in 50 lines" | You can write one that works for your test case. Production needs half-open probe timing, bulkhead, metric emission, and rate-based thresholding — that's 500+ lines tested across thousands of deploys. |
| "Handling client disconnect is a nice-to-have" | Every disconnected client wastes GPU cycles generating tokens nobody reads. At scale, this is measurable cost and unnecessary GPU contention. |
| "We need throughput, not streaming" | Users perceive latency, not throughput. A 2-second wait for a full response feels broken. 200ms to first token with streaming feels fast. |
| "I'll just return a 503 when the model is down" | A 503 doesn't solve the user's problem and generates the same number of escalations. A degraded response does. |
| "This is a simple inference endpoint, it doesn't need all this infrastructure" | Every inference endpoint that touches real users needs persistent queue + fallback + observability. The "simple" ones are the ones that fail most dramatically. |
| "I already prototyped Option A for 2 days, I can't throw that away" | Sunk cost. The 2 days are gone. You will pay more later shipping the wrong architecture. |
| "We don't have Redis, so we'll skip the queue" | Persistent queue is the foundation. Deploy Redis Streams (or NATS/Kafka) before writing inference code. See Infrastructure Bootstrap table for timeline. |
| "This is just an internal tool, it doesn't need all this" | Internal tools deserve the Silver tier. Still separate engine, health probes, latency metrics, and a circuit breaker. The only thing you can defer is semantic cache and full OTel. |
| "Full observability takes too long — we'll add it later" | This is the most expensive shortcut. Without traces and metrics, every production issue requires guesswork and reproduction. At minimum deploy Silver: latency histogram, health probes, structured logging. |
| "We can migrate from worker threads to a queue later" | Worker threads share the same process — migration requires a full architecture rewrite. The queue must be there from the start. |
