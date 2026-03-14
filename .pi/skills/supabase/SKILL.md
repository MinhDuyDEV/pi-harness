---
name: supabase
description: Comprehensive Supabase platform MCP for database operations, edge functions, development tools, debugging, and project management. Use when working with Supabase projects, databases, or APIs.
version: 1.0.0
tags: [integration, mcp]
dependencies: []
---

# Supabase Platform (MCP)

## When to Use

- When you need to manage Supabase projects, databases, or edge functions via MCP.

## When NOT to Use

- When the backend is not Supabase or MCP access is unavailable.

## Available Tools

### Account & Projects

- `list_projects` - Lists all Supabase projects
- `get_project` - Gets details for a specific project
- `list_organizations` - Lists all organizations

### Database

- `list_tables` - Lists all tables in specified schemas
- `list_extensions` - Lists PostgreSQL extensions
- `list_migrations` - Lists database migrations
- `execute_sql` - Executes raw SQL queries

### Development

- `get_project_url` - Gets the API URL for a project
- `get_publishable_keys` - Gets anonymous API keys (client-safe)
- `generate_typescript_types` - Generates TypeScript types from schema

### Edge Functions

- `list_edge_functions` - Lists all Edge Functions
- `get_edge_function` - Retrieves Edge Function file contents
- `deploy_edge_function` - Deploys or updates an Edge Function

### Debugging

- `get_logs` - Retrieves logs by service type
- `get_advisors` - Gets security/performance advisory notices

### Documentation

- `search_docs` - Searches Supabase documentation

## Workflow

### Quick Start

```
# List projects
list_projects()

# List tables in database
list_tables()

# Execute SQL query
execute_sql({"query": "SELECT * FROM users LIMIT 10"})

# Generate TypeScript types
generate_typescript_types()

# Search docs
search_docs({"query": "auth custom claims"})
```

### Get Project Credentials

```
# Get API URL and keys for project
get_project_url()
get_publishable_keys()

# List Edge Functions
list_edge_functions()

# Deploy Edge Function
deploy_edge_function({"name": "my-function", "import_map": {...}, "entrypoint": "index.ts"})
```

### Debug Issues

```
# Get logs by service
get_logs({"service": "postgres", "limit": 100})

# Check advisories
get_advisors()
```

## Security Notes

- **Read-only mode**: Set `"read_only": true` in mcp.json to disable write operations
- **Project scoping**: Use `project_ref` to limit access to specific projects
- **Environment variables**: Set `SUPABASE_ACCESS_TOKEN` for authentication

## Server Options

For advanced usage, modify `mcp.json`:

```json
{
  "supabase": {
    "command": "npx",
    "args": ["-y", "@supabase/mcp@latest"],
    "env": {
      "SUPABASE_ACCESS_TOKEN": "your-token-here"
    },
    "includeTools": ["list_tables", "execute_sql", "..."]
  }
}
```

Configuration options:

- `project_ref` - Scope to specific project (recommended)
- `read_only` - Restrict to read-only operations (recommended)
- `features` - Enable specific tool groups

> **Note**: This skill loads 14 essential tools. Excludes experimental (branching) and storage tools that require paid plans.
