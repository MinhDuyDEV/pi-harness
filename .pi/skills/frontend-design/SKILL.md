---
name: frontend-design
description: React UI implementation patterns for Next.js App Router, Tailwind CSS v4, shadcn/ui, and Motion. Use when building React components, pages, forms, or full apps, or deciding server vs client components.
metadata:
  version: 1.1.0
  tags:
  - ui
  - design
  dependencies: []
---

# Frontend Design (React + Tailwind + shadcn)

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Server components by default.** `"use client"` only for state, effects, browser APIs.
- **Composition over configuration.** Children, render props, slots. Not 10 props.
- **Tailwind for styling, not for design.** The system; `design-taste-frontend` defines the look.
- **shadcn/ui primitives.** Don't reinvent Button, Dialog, Select. Copy, customize.
- **No CSS-in-JS for new code.** Tailwind or CSS modules.
</EXTREMELY-IMPORTANT>

## When to Use

Building any React/Next.js UI; new component/page/app; "I need a form/modal/table"; Tailwind v4 setup; shadcn/ui install.

## When NOT to Use

Server-rendered HTML (no React); simple static; non-Tailwind; "just a button" (copy shadcn).

## Component Anatomy

```tsx
// Server component (default in Next.js App Router)
export function UserCard({ user }: { user: User }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{user.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>{user.email}</p>
      </CardContent>
    </Card>
  )
}
```

Server components: no state, no effects, no browser APIs. Just data + JSX. Fast, small, cacheable.

## Client Components (When Needed)

```tsx
"use client"  // required at top
import { useState } from "react"

export function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>
}
```

Use `"use client"` for: `useState`, `useEffect`, event handlers, browser APIs, `localStorage`, `IntersectionObserver`. Boundary as small as possible.

## shadcn/ui

```bash
npx shadcn@latest add button card dialog
```

This adds to `components/ui/`. You own the code. Customize freely. Don't add what you won't customize — copy and edit.

## Tailwind v4 (key changes from v3)

```css
/* globals.css */
@import "tailwindcss";

@theme {
  --color-brand: oklch(0.7 0.15 240);
  --font-sans: "Inter", system-ui;
}
```

No more `tailwind.config.js` for most cases. Use `@theme` in CSS. v4 uses Lightning CSS, ~10x faster.

## Motion (animations)

```tsx
import { motion } from "motion/react"

<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  transition={{ duration: 0.2 }}
/>
```

Use for entrances, exits, layout transitions. Not for every interaction. Respect `prefers-reduced-motion`.

## Forms

```tsx
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

const form = useForm({
  resolver: zodResolver(Schema),
  defaultValues: { ... }
})
```

React Hook Form + Zod = typed forms with validation. Use shadcn's `<Form>` for boilerplate.

## Data Fetching

- **Server**: `async function`, `await fetch`, return JSX. Cached by default.
- **Client**: `useSWR`, `useQuery`, or React Suspense. Loading, error, revalidation.
- **Mutations**: Server Actions (Next.js) or API routes. Optimistic with `useOptimistic`.

## References (load on demand)

Deep-dives live in `references/`:

- `references/tailwind/` — `v4-config.md`, `v4-features.md`, `utilities-layout.md`, `utilities-styling.md`, `responsive.md`
- `references/shadcn/` — `setup.md`, `core-components.md`, `form-components.md`, `theming.md`, `accessibility.md`
- `references/animation/` — `motion-core.md`, `motion-advanced.md`
- `references/design/` — `color-system.md`, `typography-rules.md`, `interaction.md`, `ux-writing.md`
- `references/canvas/` — `philosophy.md`, `execution.md` (creative canvas work)

Read the relevant file before deep work in that area instead of guessing APIs.

## Red Flags

`"use client"` on everything (server by default); hand-rolled Button/Dialog/Select (copy shadcn); `useEffect` for derived state; prop drilling 4+ levels; `localStorage` or browser APIs in server components; `Math.random()` in render (hydration mismatch); no loading, error, or boundary states; CSS-in-JS in new code; "memoize everything" / "memoize later".
