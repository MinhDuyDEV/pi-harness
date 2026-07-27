---
name: resend
description: >-
  Resend email integration: transactional sends, React Email templates, inbound email webhooks, and audience/bulk
  sends. User-invoked: load via /skill:resend when the project sends email through Resend, needs React Email
  templates, or handles inbound email webhooks.
metadata:
  version: 1.0.0
  tags:
  - integration
  - mcp
  dependencies: []
disable-model-invocation: true
---

# Resend (Email)

## Iron Laws

<EXTREMELY-IMPORTANT>
- **React Email for templates, not string-concatenated HTML.** Components live in `emails/`, typed props, compiled to email-client-compatible HTML. Inline styles only.
- **Typed SDK send.** `resend.emails.send({ ..., react: Template(props) })` — not hand-built JSON against the raw API.
- **Inbound email arrives via webhook, not polling or IMAP.** The `email.received` webhook carries metadata only — fetch body and attachments through the Receiving/Attachments APIs.
- **API key in env (`RESEND_API_KEY`), never in code.**
- **Single `to:` for transactional; Audiences for managed marketing lists.**
</EXTREMELY-IMPORTANT>

## When to Use

Transactional sends (magic link, verification, password reset, receipts); newsletters and bulk notifications; inbound email handling; building or previewing email templates.

## Setup

```bash
npm i resend react-email @react-email/components
export RESEND_API_KEY="re_..."
```

## Method

1. Model each email as a React Email component in `emails/`; preview locally with `email dev` before sending anything.
2. Send with the typed SDK, passing the component to the `react` prop.
3. Use `POST /emails/batch` (max 100) for multiple distinct emails; Audiences + `contacts` API for managed lists.
4. For replies/inbound: configure the receiving domain (MX record or `.resend.app`), subscribe a webhook to `email.received`, then retrieve content via the API — the webhook payload does not contain the body.

## References

- See `references/send-email.md` for single vs batch endpoints, scheduling, attachments, and idempotency.
- See `references/react-email.md` for template components, client compatibility, and the preview workflow.
- See `references/receive-email.md` for inbound domains, webhook events, and content retrieval.

## Red Flags

String-concatenated HTML instead of React Email; API key committed to code; polling or IMAP for inbound; treating the inbound webhook payload as if it contained the full body; test emails sent to real addresses; bulk sends without an unsubscribe link; missing `replyTo`; no error or rate-limit handling around send calls; "templates later" (templates first).
