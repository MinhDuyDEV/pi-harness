---
name: security-and-hardening
description: Use when auditing for security vulnerabilities, implementing auth/authz, handling secrets, or hardening against OWASP Top 10 — covers input validation, authentication, dependency auditing, and secure defaults
version: 1.0.0
tags: [security, code-quality]
dependencies: []
---

# Security & Hardening

> **Replaces** "we'll add security later" with security-by-default patterns applied from the start

## When to Use

- Implementing authentication or authorization
- Handling user input that touches databases, file systems, or external services
- Reviewing code for security vulnerabilities
- Running dependency audits or responding to CVE alerts
- Deploying to production for the first time

## When NOT to Use

- Local-only developer tools with no network exposure
- Throwaway prototypes that will never see user data
- Performance optimization (that's a different skill)

## Overview

Security is a constraint, not a feature. It should be present by default and requires explicit justification to relax.

**Core principle:** Validate all input. Authenticate all access. Encrypt all secrets. Audit all dependencies. Trust nothing from outside your process boundary.

## Security Boundaries

### Always

- Validate and sanitize all user input at the boundary
- Use parameterized queries (never string interpolation for SQL)
- Hash passwords with bcrypt/scrypt/argon2 (never MD5/SHA for passwords)
- Use HTTPS for all external communication
- Store secrets in environment variables, never in code
- Set secure defaults (CORS restrictive, CSP strict, cookies httpOnly+secure)

### Ask First

- Changing authentication mechanism or session handling
- Adding new API endpoints that accept user data
- Modifying CORS policy or CSP headers
- Adding new third-party dependencies with network access
- Storing new types of PII or sensitive data

### Never

- Commit secrets, API keys, or credentials to git
- Disable CSRF protection
- Use `eval()` or `Function()` with user input
- Trust client-side validation as the only validation
- Log sensitive data (passwords, tokens, PII)

## OWASP Top 10 Patterns

### 1. Injection (SQL, NoSQL, Command)

```typescript
// ❌ SQL Injection
const user = await db.query(`SELECT * FROM users WHERE id = '${userId}'`);

// ✅ Parameterized query
const user = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
```

```typescript
// ❌ Command injection
exec(`convert ${filename} output.png`);

// ✅ Safe argument passing
execFile("convert", [filename, "output.png"]);
```

### 2. Broken Authentication

```typescript
// ✅ Password hashing
import bcrypt from "bcrypt";
const hash = await bcrypt.hash(password, 12); // cost factor 12
const valid = await bcrypt.compare(input, hash);

// ✅ Session management
const session = {
  httpOnly: true, // No JS access
  secure: true, // HTTPS only
  sameSite: "lax", // CSRF protection
  maxAge: 3600, // 1 hour expiry
};
```

### 3. Sensitive Data Exposure

```typescript
// ❌ Logging sensitive data
console.log("User login:", { email, password });

// ✅ Redact sensitive fields
console.log("User login:", { email, password: "[REDACTED]" });

// ✅ API response excludes internal fields
function toPublicUser(user: DbUser): PublicUser {
  const { passwordHash, internalId, ...publicFields } = user;
  return publicFields;
}
```

### 4. Broken Access Control

```typescript
// ❌ No authorization check
app.get("/api/users/:id", async (req, res) => {
  const user = await getUser(req.params.id);
  res.json(user); // Any authenticated user can access any profile
});

// ✅ Authorization check
app.get("/api/users/:id", async (req, res) => {
  const user = await getUser(req.params.id);
  if (user.id !== req.auth.userId && !req.auth.isAdmin) {
    return res.status(403).json({ error: "Forbidden" });
  }
  res.json(user);
});
```

### 5. Security Misconfiguration

```typescript
// ✅ Secure headers (use helmet for Express)
import helmet from "helmet";
app.use(helmet());

// ✅ CORS — restrictive by default
app.use(
  cors({
    origin: ["https://myapp.com"], // Not '*'
    methods: ["GET", "POST"],
    credentials: true,
  }),
);

// ✅ CSP
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"], // No 'unsafe-inline'
      styleSrc: ["'self'", "'unsafe-inline'"], // Only if needed
    },
  }),
);
```

## Input Validation Patterns

```typescript
import { z } from "zod";

// ✅ Validate at the boundary
const createUserSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().max(254),
  age: z.number().int().min(0).max(150).optional(),
});

// ✅ Reject unknown fields
const input = createUserSchema.strict().parse(req.body);
```

| Input Type  | Validation                                   |
| ----------- | -------------------------------------------- |
| String      | Min/max length, regex pattern, trim          |
| Number      | Min/max range, integer check                 |
| Email       | Format validation, max 254 chars             |
| URL         | Protocol whitelist (https only)              |
| File upload | Type whitelist, max size, content validation |
| Array       | Max length, item validation                  |

## Dependency Audit

### npm Audit Triage

```bash
# Run audit
npm audit

# Decision tree per vulnerability:
# 1. Is it in production dependencies? (devDeps are lower priority)
# 2. Is the vulnerability reachable in our usage?
# 3. Is a patch available? → Update
# 4. No patch? → Find alternative or add compensating control
```

| Severity | Action                | Timeline               |
| -------- | --------------------- | ---------------------- |
| Critical | Fix immediately       | Same day               |
| High     | Fix in current sprint | Within 1 week          |
| Medium   | Plan fix              | Within 1 month         |
| Low      | Track and monitor     | Next convenient update |

### Supply Chain Security

- [ ] Use lockfile (`package-lock.json` / `pnpm-lock.yaml`) — commit it
- [ ] Pin major versions in production dependencies
- [ ] Review new dependencies before adding (check maintainers, download count, last update)
- [ ] Enable Dependabot or Renovate for automated updates
- [ ] Use `npm audit` or `pnpm audit` in CI pipeline

## Secrets Management

| Rule                      | Implementation                                   |
| ------------------------- | ------------------------------------------------ |
| Never in code             | Use `.env` files (gitignored) or secret managers |
| Never in logs             | Redact before logging                            |
| Never in URLs             | Use headers or body for tokens                   |
| Rotate on exposure        | Immediate rotation + audit trail                 |
| Different per environment | Staging keys ≠ production keys                   |
| Least privilege           | Each secret grants minimum required access       |

```bash
# ✅ .gitignore
.env
.env.local
.env.*.local
*.key
*.pem
```

## Rate Limiting

```typescript
// ✅ Basic rate limiting
import rateLimit from "express-rate-limit";

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, try again later" },
});

app.use("/api/", limiter);

// ✅ Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 login attempts per 15 minutes
});
app.use("/api/auth/", authLimiter);
```

## Common Rationalizations

| Excuse                             | Rebuttal                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| "It's an internal app"             | Internal apps get compromised too. Validate all input regardless.             |
| "We'll add security before launch" | Security retrofit is 10x harder than building it in. Start now.               |
| "Nobody will find this endpoint"   | Security through obscurity isn't security. Assume everything is discoverable. |
| "The framework handles it"         | Frameworks have defaults, not guarantees. Verify your specific configuration. |
| "This is just a prototype"         | Prototypes become production. Build secure habits from day one.               |
| "The audit has too many warnings"  | Triage by severity. Critical/High first, Low can wait.                        |

## Red Flags — STOP

- String concatenation in SQL queries
- Passwords stored in plaintext or MD5/SHA
- API keys or secrets in source code
- CORS set to `*` in production
- No rate limiting on authentication endpoints
- User input passed directly to `exec()`, `eval()`, or file system operations
- Dependencies with known critical CVEs
- No input validation at API boundaries

## Verification

- [ ] All user input validated with schemas at API boundaries
- [ ] SQL queries use parameterized statements
- [ ] Passwords hashed with bcrypt/scrypt/argon2 (cost ≥ 12)
- [ ] No secrets in source code or logs
- [ ] CORS, CSP, and security headers configured
- [ ] `npm audit` shows no critical/high vulnerabilities
- [ ] Rate limiting on authentication and sensitive endpoints
- [ ] Authorization checks on all protected resources

## See Also

- **defense-in-depth** — Validation at every layer, not just the boundary
- **api-and-interface-design** — Error responses that don't leak internals
- **ci-cd-and-automation** — Running security checks in CI pipeline
