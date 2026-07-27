---
name: cloudflare
description: >-
  Covers Cloudflare platform work — Workers (V8 isolates), wrangler config, KV/D1/R2/Queues bindings,
  Pages, secrets — with per-service reference docs. User-invoked: load via /skill:cloudflare when
  writing Workers code, editing wrangler.toml, choosing between KV/D1/R2, or configuring any
  Cloudflare service.
metadata:
  version: 1.0.0
  tags:
  - integration
  - devops
  dependencies: []
disable-model-invocation: true
---

# Cloudflare

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Workers are V8 isolates, not Node.js.** No `fs`, no `child_process`, no `Buffer` (use `Uint8Array`).
- **Edge runtime = small, fast, cold.** Keep bundles small. No kitchen sink imports.
- **Secrets via `wrangler secret put`**, never in `wrangler.toml`. Never in code.
- **Compatibility flags** for Node APIs (`nodejs_compat`, `nodejs_compat_v2`).
- **Bindings over fetch.** Use D1/R2/KV bindings, not HTTP to own services.
</EXTREMELY-IMPORTANT>

## When to Use

Writing Workers; configuring `wrangler.toml`; bindings (KV, D1, R2, Queues); Pages; Workers AI; Tunnels; WAF; DNS; any Cloudflare infra.

## When NOT to Use

Plain Node.js server; static hosting without Workers; a different platform.

## Core Services

| Service | Use |
|---|---|
| **Workers** | Compute at the edge (V8 isolate) |
| **Pages** | Static + Workers Functions |
| **KV** | Low-latency key-value (eventually consistent) |
| **D1** | SQLite at the edge |
| **R2** | S3-compatible, no egress fees |
| **Queues** | Async messaging |
| **Workers AI** | Run models on Workers |
| **Vectorize** | Vector DB for similarity search |
| **Tunnel** | Secure origin connectivity |
| **WAF** | Web app firewall rules |
| **DNS** | Authoritative DNS |

## Workers Code Anatomy

```ts
export interface Env {
  DB: D1Database
  BUCKET: R2Bucket
  KV: KVNamespace
  AI: Ai
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // ...
  }
}
```

`Env` is the contract. Bindings typed via Cloudflare's type defs.

## wrangler.toml (config)

```toml
name = "my-worker"
main = "src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "KV"
id = "..."

[[d1_databases]]
binding = "DB"
database_name = "..."
database_id = "..."
```

Bindings declared, IDs in config, secrets via CLI.

## Secrets

```bash
wrangler secret put API_TOKEN
# prompts for value; stored encrypted in Cloudflare
```

Use `env.SECRET_NAME` in code. NEVER in `wrangler.toml`, NEVER in git.

## KV (eventually consistent)

```ts
await env.KV.put("user:123", JSON.stringify(user), { expirationTtl: 3600 })
const user = JSON.parse(await env.KV.get("user:123"))
```

Updates are eventually consistent (60s globally). Strong consistency → D1.

## D1 (SQLite at edge)

```ts
const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind("123").first()
await env.DB.prepare("INSERT INTO users (id, name) VALUES (?, ?)").bind("123", "Alice").run()
```

SQLite semantics. Transactions via `db.batch([...])`.

## R2 (object storage)

```ts
await env.BUCKET.put("file.pdf", data, { httpMetadata: { contentType: "application/pdf" } })
```

S3-like API. No egress fees. Public buckets for static.

## Local Dev

```bash
wrangler dev
# local server with bindings simulated
```

`--remote` uses real Cloudflare bindings; `--local` is fastest.

## References

Per-service docs live in `references/<service>/` — each folder has `api.md`, `configuration.md`, `patterns.md`, `gotchas.md`. Read the matching folder before non-trivial work on a service.

| Domain | Folders under `references/` |
|---|---|
| Compute | workers, durable-objects, workflows, containers, sandbox, cron-triggers, smart-placement, tail-workers, workers-for-platforms |
| AI | workers-ai, ai-gateway, ai-search, agents-sdk, vectorize, browser-rendering |
| Storage / data | kv, d1, r2, r2-sql, r2-data-catalog, do-storage, hyperdrive, queues, pipelines, analytics-engine |
| Web delivery | pages, pages-functions, static-assets, snippets, cache-reserve, images, stream, zaraz, web-analytics |
| Security | waf, ddos, bot-management, api-shield, turnstile, secrets-store |
| Network | tunnel, spectrum, argo-smart-routing, network-interconnect, workers-vpc |
| Email / realtime | email-routing, email-workers, realtime-sfu, realtimekit, turn |
| Tooling / IaC | wrangler, c3, miniflare, workerd, terraform, pulumi, api, bindings, observability, workers-playground |

## Red Flags

Node.js APIs in Workers (`import fs`, `Buffer`, `child_process`); bundle > 1MB; secrets in `wrangler.toml`; HTTP fetch to your own service (`fetch('https://my-db.example.com')` — use a binding); missing `compatibility_date`; KV for transactional data (use D1); D1 for hot cache (use KV); shipping without `wrangler dev`.
