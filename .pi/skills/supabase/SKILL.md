---
name: supabase
description: Supabase platform guide — MCP server setup for projects, database, and edge functions, plus Postgres best-practice rules for queries, indexes, RLS, schema design, and connection pooling. User-invoked; load via /skill:supabase when working on a Supabase backend or tuning its Postgres.
metadata:
  version: 2.0.0
  tags:
  - integration
  - mcp
  - code-quality
  dependencies: []
disable-model-invocation: true
---

# Supabase

## When to Use

Managing Supabase projects, databases, or edge functions via MCP; writing or reviewing Postgres queries, schemas, indexes, or RLS policies on Supabase.

## When NOT to Use

The backend is not Supabase; generic Postgres advice with no Supabase context is also fine from base knowledge — load this for the rules/ files when it matters.

## MCP Server

The bundled [mcp.json](mcp.json) registers `@supabase/mcp-server-supabase` with 16 tools. Authentication comes from the `SUPABASE_ACCESS_TOKEN` environment variable:

```json
{
  "supabase": {
    "command": "npx",
    "args": ["-y", "@supabase/mcp-server-supabase@latest"],
    "env": { "SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}" }
  }
}
```

Recommended hardening: `project_ref` to scope access to one project, `read_only: true` to disable writes. Experimental (branching) and paid-plan storage tools are excluded.

### Tool Groups

| Group | Tools |
| --- | --- |
| Account & projects | `list_projects`, `get_project`, `list_organizations` |
| Database | `list_tables`, `list_extensions`, `list_migrations`, `execute_sql` |
| Development | `get_project_url`, `get_publishable_keys`, `generate_typescript_types` |
| Edge functions | `list_edge_functions`, `get_edge_function`, `deploy_edge_function` |
| Debugging | `get_logs` (by service), `get_advisors` (security/perf notices) |
| Docs | `search_docs` |

Typical flow: `list_projects` → `list_tables` → `execute_sql` for inspection, `generate_typescript_types` after schema changes, `get_advisors` before shipping.

## Postgres Best Practices

Rules live in [rules/](rules/), one file per rule, each with why-it-matters plus incorrect/correct SQL examples. Read the files for the category you are touching:

| Priority | Category | Impact | Files |
| --- | --- | --- | --- |
| 1 | Query performance | CRITICAL | `rules/query-*.md` (missing, composite, partial, covering indexes; index types) |
| 2 | Connection management | CRITICAL | `rules/conn-*.md` (pooling, limits, idle timeout, prepared statements) |
| 3 | Security & RLS | CRITICAL | `rules/security-*.md` (RLS basics, RLS performance, privileges) |
| 4 | Schema design | HIGH | `rules/schema-*.md` (data types, primary keys, FK indexes, partitioning, lowercase identifiers) |
| 5 | Concurrency & locking | MEDIUM-HIGH | `rules/lock-*.md` (short transactions, skip locked, advisory, deadlocks) |
| 6 | Data access patterns | MEDIUM | `rules/data-*.md` (pagination, upsert, batch inserts, N+1) |
| 7 | Monitoring | LOW-MEDIUM | `rules/monitor-*.md` (`pg_stat_statements`, `EXPLAIN ANALYZE`, vacuum) |
| 8 | Advanced features | LOW | `rules/advanced-*.md` (JSONB indexing, full-text search) |

Start at the highest-priority category relevant to the change; cite the rule file when applying one in review.

## Red Flags

Writing RLS policies without reading `rules/security-rls-performance.md` (per-row function calls are the classic footgun); `execute_sql` with write statements when `read_only` would do; schema changes without regenerating TypeScript types; pasting real access tokens into config files instead of `${SUPABASE_ACCESS_TOKEN}`; skipping `get_advisors` before shipping schema or policy changes.
