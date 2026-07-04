---
name: resend
description: MUST load before sending transactional emails, creating React Email templates, handling email webhooks, or any Resend platform integration. Covers send, receive inbound, templates, and webhook handling.
version: 1.0.0
tags: [integration, mcp]
dependencies: []
agent_types: [planner, worker, reviewer]
tools: []
---

# Resend (Email)

## Iron Laws

<EXTREMELY-IMPORTANT>
- **React Email for templates, not string concatenation.** `emails/` directory, `jsx` components, first-class typing.
- **`resend.emails.send()` with a typed payload.** Not `JSON.stringify` to a raw API.
- **Inbound email webhook for reply handling.** Not polling, not IMAP.
- **Templates in `emails/`, not in the API route.** `export WelcomeEmail = () => ...` is the pattern.
- **Audience for bulk sends.** Single `to:` for transactional. `audienceId:` for marketing.
</EXTREMELY-IMPORTANT>

## When to Use

Sending transactional emails; newsletter / bulk; inbound email handling; email templates; email + auth flows (magic link, verification, password reset); webhook handling.

## Setup

```bash
npm i resend react-email @react-email/components
export RESEND_API_KEY="re_..."
```

API key in env, not in code. Free tier: 100 emails/day.

## Sending

```ts
import { Resend } from "resend"
const resend = new Resend(process.env.RESEND_API_KEY)

await resend.emails.send({
  from: "onboarding@resend.dev",
  to: "user@example.com",
  subject: "Welcome",
  react: WelcomeEmail({ name: "Alice" }),
})
```

`react` prop takes a React component. Type-safe. Inline styles only (React Email doesn't support CSS-in-JS).

## Templates

```tsx
// emails/WelcomeEmail.tsx
import { Html, Head, Body, Container, Text, Button } from "@react-email/components"

export default function WelcomeEmail({ name }: { name: string }) {
  return (
    <Html>
      <Body>
        <Container>
          <Text>Hi {name},</Text>
          <Button href="https://example.com">Get started</Button>
        </Container>
      </Body>
    </Html>
  )
}
```

Compiled to string at build time. Preview locally with `email dev`.

## Inbound Email

```ts
// Webhook handler (POST /api/resend/inbound)
export async function POST(req: Request) {
  const { email, subject, text, html, attachments } = await req.json()
  // Process the inbound email
}
```

Configure in Resend dashboard: `inbound@yourdomain.com` → webhook URL. Subject, body, attachments included in payload.

## Bulk / Audiences

```ts
await resend.contacts.create({ email: "user@example.com", audienceId: "..." })
await resend.emails.send({
  from: "newsletter@example.com",
  subject: "Monthly update",
  react: NewsletterEmail(),
  to: ["user1@example.com", "user2@example.com"],
})
```

Use `Audience` API for lists. Send via `to:` array or `audienceId:`.

## Common Mistakes

API key in code; string-concatenated HTML (use React Email); `resend.emails.send` with raw HTML (loses type safety); no webhook for inbound (polling instead); missing attachments; sending to unconfirmed addresses; no rate limiting; no error handling; "I'll add templates later" (templates first); test emails sent to real addresses; missing `replyTo` field.

## Red Flags

API key in code; string HTML; no React Email; polling for inbound; no error handling; "templates later"; test to real addresses; no `replyTo`; sending without checking `to` address; missing `bcc` for compliance; no unsubscribe link in bulk sends.

## Red Flags (continued)

Rate limiting not handled; "test email" sent to real user; no template preview (`email dev`); missing dark mode support in email (most email clients don't support it, but worth checking).

## Anti-Patterns

**String HTML** (React Email); **API key in code**; **no templates**; **polling for inbound**; **no error handling**; **"templates later"**; **test to real addresses**; **no `replyTo`**; **no unsubscribe**.
