---
name: security-and-hardening
description: Use when auditing for security vulnerabilities, implementing auth/authz, handling secrets, or hardening against OWASP Top 10 — covers input validation, authentication, dependency auditing, and secure defaults
version: 1.0.0
tags: [security, code-quality]
dependencies: []
agent_types: [planner, worker, reviewer]
tools: []
---

# Security & Hardening

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Validate at every boundary.** Decode at the edge, trust the types inside.
- **Secrets never in code, logs, or git.** Env vars, vault for prod.
- **Authn ≠ Authz.** Who you are ≠ what you can do.
- **Least privilege by default.** Deny by default, allow explicitly.
- **Log security events.** Failed logins, denials, secret access. Never the secrets themselves.
</EXTREMELY-IMPORTANT>

## OWASP Top 10 (Quick Map)

| Risk | Defense |
|---|---|
| Injection | Parameterized queries, schema-validated input |
| Broken auth | Rate limit, MFA, bcrypt/argon2 |
| Data exposure | Encrypt at rest + transit, minimize retention |
| XXE | Disable external entities |
| Access control | Authz on every action, deny default |
| Misconfig | Secure defaults, no debug in prod, headers |
| XSS | Output encoding, CSP, no innerHTML w/ user input |
| Deserialization | Schema-validate, no eval/pickle on untrusted |
| Vulns (deps) | `npm audit`, Dependabot, lockfile pinning |
| Logging | Auth events, anomalies, access denials |

## Input Validation

- Validate at the boundary. Inside, trust the types.
- Schema (Zod, Effect Schema) for all external input.
- Reject unknown fields by default.
- Length limits, character class, format per field.

## Authentication

- bcrypt or argon2 for password hashing (NOT md5, sha1).
- Rate limit login (5 per 15min per IP + per account).
- MFA for sensitive accounts.
- Session: random, signed, httpOnly cookie, short expiry.
- Refresh: separate, longer expiry, rotation on use.

## Authorization

- Check on every request. Don't trust the frontend.
- Use a policy engine (CASL, Oso) or explicit checks.
- Test the negative: "user A tries to access user B's resource" must fail.
- Audit log access denials.

## Secrets

- Local: env vars, never `.env` in git.
- CI: secret store (GitHub Actions secrets).
- Prod: vault (HashiCorp Vault, AWS Secrets Manager).
- Rotate regularly. Rotate on suspected leak.
- Never log secrets. Scrub logs for known patterns.

## Dependencies

```bash
npm audit
npm audit fix
```

Pin versions in lockfile. Review major bumps. Subscribe to advisories.

## Secure Headers

```ts
app.use(helmet())
// or manually:
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  res.setHeader("Content-Security-Policy", "default-src 'self'")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  next()
})
```

## Common Mistakes

Plain-text passwords; md5/sha1; SQL string concat; "trust the frontend" authz; secrets in git; no rate limit on auth; session in localStorage; no CSP; logging secrets; no HTTPS; user-controlled redirects; eval on input; no CORS config; no security headers; default admin creds; error messages revealing internals.

## Red Flags

`.env` in git; bcrypt replaced with sha256; "auth later"; user ID from client trusted; no rate limit; secrets in logs; no CSP; permissive CORS; default creds; SQL concat; eval on input; "private" routes without auth.

## Anti-Patterns

**"Auth later"**; **bcrypt-less**; **client-trusted IDs**; **no rate limit**; **secrets in code**; **"we're internal"**; **security by obscurity**.
