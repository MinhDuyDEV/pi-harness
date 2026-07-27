---
name: polar
description: >-
  Polar billing integration via @polar-sh/sdk — checkout sessions, subscriptions, license key
  validation, and signed webhook handling. User-invoked: load via /skill:polar when implementing
  payments, monetization, license keys, or customer portals on the Polar platform.
metadata:
  version: 1.0.0
  tags:
  - integration
  - mcp
  dependencies: []
disable-model-invocation: true
---

# Polar Integration

## When to Use

Implementing Polar checkout, subscriptions, license keys, customer portals, or payment webhooks.

## When NOT to Use

Payments handled by a different platform (Stripe, Paddle, Lemon Squeezy).

## Quick Start

```bash
npm install @polar-sh/sdk
```

```typescript
import { Polar } from "@polar-sh/sdk";

const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  server: "sandbox", // "production" only after the flow is verified end to end
});
```

## Key APIs

| API                     | Purpose                           |
| ----------------------- | --------------------------------- |
| `polar.products.*`      | Create/manage products and prices |
| `polar.checkouts.*`     | Create checkout sessions          |
| `polar.subscriptions.*` | Manage subscriptions              |
| `polar.orders.*`        | View order history                |
| `polar.customers.*`     | Customer management               |
| `polar.licenseKeys.*`   | Issue and validate licenses       |

This table is orientation only — verify current method signatures against the [API docs](https://docs.polar.sh/api-reference) before writing code; SDK surfaces drift.

## Environment Variables

| Variable               | Description                     |
| ---------------------- | ------------------------------- |
| `POLAR_ACCESS_TOKEN`   | Organization Access Token (OAT) |
| `POLAR_WEBHOOK_SECRET` | Webhook signing secret          |

## Common Patterns

```typescript
// Create checkout, then redirect to checkout.url
const checkout = await polar.checkouts.create({
  productId: "prod_xxx",
  successUrl: "https://myapp.com/success",
});

// Validate a license key
const result = await polar.licenseKeys.validate({
  key: "XXXX-XXXX-XXXX-XXXX",
  organizationId: "org_xxx",
});

// Handle a webhook — signature check is mandatory
import { validateEvent } from "@polar-sh/sdk/webhooks";
const event = validateEvent(body, signature, process.env.POLAR_WEBHOOK_SECRET!);
// event.type: "subscription.created", "order.created", etc.
```

## Red Flags

Granting entitlements from the client's success redirect instead of a verified webhook event; skipping `validateEvent` signature verification; developing against production instead of sandbox; hardcoded access tokens (env vars only); trusting the API table above over current docs for exact signatures.

## Links

- [Dashboard](https://polar.sh)
- [API Docs](https://docs.polar.sh/api-reference)
- [SDK](https://www.npmjs.com/package/@polar-sh/sdk)
