---
name: security-and-hardening
description: Security audit and hardening mapped to the OWASP Top 10 — boundary validation, authn/authz, secrets. Use when auditing for vulnerabilities, implementing auth, or when a diff touches cookies or CORS.
metadata:
  version: 1.0.0
  tags:
  - security
  - code-quality
  dependencies: []
---

# Security & Hardening

> Migration: this skill now owns the former `defense-in-depth` workflow. See
> `../superpi/MIGRATIONS.md`. Read `references/layered-validation.md` for the
> boundary map, validation matrix, and five defense patterns.

For exploit-focused review, load `references/security-review-playbook.md`.

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Validate at every boundary.** Decode at the edge, trust the types inside.
- **Secrets never in code, logs, or git.** Env vars locally, secret store in CI, vault in prod.
- **Authn ≠ Authz.** Who you are ≠ what you can do. Check authz on every request; never trust the frontend.
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

## Decisions That Matter

- Passwords: bcrypt or argon2 — never md5, sha1, or plain sha256.
- Rate limit auth endpoints (e.g. 5 attempts / 15 min, per IP and per account).
- Sessions: random, signed, httpOnly cookie with short expiry — not localStorage. Refresh tokens separate, rotated on use.
- Schema-validate (Zod, Effect Schema) all external input; reject unknown fields; enforce length and format per field.
- Test the negative: "user A requests user B's resource" must fail — write that test.
- Dependencies: pin via lockfile, run `npm audit` in CI, review major bumps.
- Headers: `helmet()` or explicit CSP, HSTS, `X-Content-Type-Options: nosniff`, frame deny, referrer policy.
- Rotate secrets on schedule and on suspected leak; scrub logs for known secret patterns.

## Red Flags

`.env` in git; SQL built by string concatenation; authz decisions from client-supplied IDs; "auth later"; no rate limit on login; session in localStorage; permissive CORS; default admin creds; `eval` on user input; secrets in logs; error messages leaking internals; user-controlled redirects; "we're internal" or security-by-obscurity as an argument.
