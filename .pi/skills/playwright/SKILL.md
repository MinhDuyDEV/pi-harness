---
name: playwright
description: >-
  Automated browser testing with Playwright: role-based locators, user-visible wait strategy,
  CLI-first execution with MCP fallback, and an agent-browser CLI alternative. Use when writing or
  fixing browser tests, validating forms or UX flows, taking screenshots, or debugging flaky
  selectors and timeouts.
metadata:
  version: 1.0.0
  tags:
  - automation
  - mcp
  - testing
  dependencies: []
---

# Playwright (Automated Browser Testing)

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Test user behavior, not implementation.** "User clicks Submit" not "Form posts to /api/save".
- **Locators by role / label / text, not CSS.** `[data-testid]` is a fallback, not a default.
- **Wait for the user-visible state, not the network.** `expect(page).toHaveText(...)` not `page.waitForResponse`.
- **One test = one user intent.** Don't chain unrelated assertions.
- **Stable tests, not exhaustive tests.** Cover the 5 critical flows, not the 50 edge cases.
</EXTREMELY-IMPORTANT>

## CLI-First (Token Efficiency)

```bash
# Install once
npx playwright install

# Run a single test
npx playwright test tests/login.spec.ts

# Run with specific browser
npx playwright test --project=chromium

# Debug mode
npx playwright test --debug

# Show report
npx playwright show-report
```

Prefer CLI over MCP for token efficiency. Use MCP (see `mcp.json`) only for: complex exploration, error screenshots, or when the test environment is too dynamic to script.

See [references/agent-browser-cli.md](references/agent-browser-cli.md) for the agent-browser CLI alternative to Playwright MCP.
See `references/browser-devtools.md` for live Chrome routing and runtime
evidence when static Playwright assertions are not enough.

## Locator Strategy

```ts
// PREFERRED: by role (semantic, accessible)
await page.getByRole("button", { name: "Submit" }).click()
await page.getByLabel("Email").fill("user@example.com")
await page.getByText("Welcome").toBeVisible()

// OK: by test id (when role isn't available)
await page.getByTestId("submit-button").click()

// AVOID: CSS selectors (brittle)
await page.locator(".btn.btn-primary.submit").click() // NO
```

## Wait Strategy

```ts
// GOOD: wait for user-visible state
await expect(page.getByText("Order confirmed")).toBeVisible()

// GOOD: wait for navigation
await page.getByRole("link", { name: "Dashboard" }).click()
await expect(page).toHaveURL(/\/dashboard/)

// BAD: arbitrary timeout
await page.waitForTimeout(2000) // NO

// BAD: wait for network (race conditions)
await page.waitForResponse("**/api/save") // NO
```

## Test Anatomy

```ts
import { test, expect } from "@playwright/test"

test("user can submit a form", async ({ page }) => {
  // Arrange
  await page.goto("/contact")
  // Act
  await page.getByLabel("Email").fill("user@example.com")
  await page.getByLabel("Message").fill("Hello")
  await page.getByRole("button", { name: "Send" }).click()
  // Assert
  await expect(page.getByText("Message sent")).toBeVisible()
})
```

AAA: Arrange, Act, Assert. One intent per test. Comments are not needed for the obvious.

## Screenshots

```ts
await page.screenshot({ path: "screenshot.png", fullPage: true })
```

Use for visual regression. Don't screenshot in every test — only when visual state matters.

## Red Flags

CSS selector chains or `page.locator(".x").nth(2)` (brittle — use role/label); `page.waitForTimeout` (flaky — wait for user-visible state); "wait for response" assertions (race conditions); testing implementation ("form posts to /api/X") instead of user intent; tests that depend on order or share state (cookies, login); tests that pass in CI but fail locally (or vice versa); "test everything" coverage instead of the 5 critical flows; screenshotting in every test; flaky retries without root cause; missing `await` on `expect` (silent pass); one file with 50+ tests and no `test.describe` grouping.
