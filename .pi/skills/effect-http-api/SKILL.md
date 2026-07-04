---
name: effect-http-api
version: 1.0.0
description: "Use when building HTTP APIs with Effect HttpApi — defining typed endpoints and groups, implementing handlers with Effect services, mapping service errors to HTTP errors with proper status codes, adding SSE streaming endpoints, implementing auth middleware with typed provides, generating OpenAPI documentation, and serving production HTTP servers. MUST load before writing any HttpApi endpoint or handler."
---

# Effect HTTP API

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Schema-first, never raw handlers.** `HttpApiEndpoint` + `HttpApiGroup` define the contract; handlers implement it.
- **Domain errors map to HTTP status.** `UserNotFound → 404`, `ValidationError → 400`. Never return 500 for a known business error.
- **Services are provided at the group level.** `HttpApiGroup.make("users").pipe(Layer.provide(UserRepoLive))`.
- **SSE is a first-class endpoint type.** `HttpApiEndpoint.get(...).pipe(HttpApiResponse.stream(...))`. No manual `EventSource` server.
- **Auth is a `Security` middleware, not a handler concern.** `HttpAuthMiddleware` with a typed `Security` provider.
</EXTREMELY-IMPORTANT>

## Basic Endpoint

```ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiError } from "@effect/platform"

const getUser = HttpApiEndpoint.get("getUser", "/users/:id")
  .setPath(Schema.Struct({ id: UserId }))
  .addSuccess(User)
  .addError(UserNotFound, { status: 404 })

const usersGroup = HttpApiGroup.make("users")
  .add(getUser)
  .pipe(Layer.provide(UserRepoLive))
```

The schema drives type checking, OpenAPI generation, and request validation.

## Group Composition

```ts
const api = HttpApi.make("myApp")
  .add(usersGroup)
  .add(postsGroup)
  .add(authGroup)
  .prefix("/api/v1")
```

## Handler Implementation

```ts
const usersHandler = HttpApiBuilder.group(api, "users", (group) =>
  Effect.gen(function* () {
    const repo = yield* UserRepo
    return group.handle("getUser", ({ path }) =>
      repo.findById(path.id).pipe(
        Effect.orElseFail(() => new UserNotFound({ id: path.id }))
      )
    )
  })
)
```

Handlers are pure (no HTTP concerns). They take a request, return an effect that produces a value or fails with a domain error. The framework maps errors to HTTP.

## Error → HTTP Status

```ts
.addError(UserNotFound, { status: 404 })
.addError(ValidationError, { status: 400 })
.addError(Unauthorized, { status: 401 })
.addError(Forbidden, { status: 403 })
.addError(NotFound, { status: 404 })
.addError(Conflict, { status: 409 })
.addError(RateLimited, { status: 429 })
```

Domain errors map to the right status. Don't return 500 for a 404.

## SSE Streaming

```ts
const stream = HttpApiEndpoint.get("stream", "/events")
  .addSuccess(HttpApiResponse.stream(User))
  .addError(Unauthorized, { status: 401 })

// Handler
group.handle("stream", () =>
  Stream.fromQueue(eventQueue).pipe(
    Stream.map(eventToUser),
    Stream.encodeJson()
  )
)
```

The framework handles the SSE protocol. The handler just produces a stream of values.

## Auth Middleware

```ts
const authMiddleware = HttpAuthMiddleware.basicAuth((creds) =>
  Effect.gen(function* () {
    const users = yield* UserRepo
    const user = yield* users.findByEmail(creds.username)
    if (!(yield* verifyPassword(creds.password, user.passwordHash))) {
      return yield* Effect.fail(new Unauthorized())
    }
    return { user }
  })
)

const api = HttpApi.make(...).middleware(authMiddleware)
```

`Security` is a typed provider. Handlers access the auth context via `Effect<Request, ...>` with the security shape.

## OpenAPI Generation

```ts
import { OpenApi } from "effect"

const spec = OpenApi.fromApi(api)
// Serve at /api/openapi.json or generate a static file
```

The OpenAPI spec is derived from the schemas. No manual maintenance.

## Common Mistakes

Raw `HttpApp`; generic `Error`; business logic in handlers; auth in handler; manual SSE; manual OpenAPI; `JSON.parse` in handlers; 500 for known errors; missing `addError`; `try/catch`; no rate limit; no CORS; no `request.signal`.

## Red Flags

Raw `HttpApp`; `throw new Error`; auth in handler; 500 on validation; manual EventSource; no rate limit; no validation; hand-maintained OpenAPI; missing CORS; no graceful shutdown; no backpressure; no size limits.

## Anti-Patterns

**"Just add a route"** (skip the schema); **"catch in handler"**; **"auth here is fine"** (middleware); **"manual SSE"**; **hand-written OpenAPI**.
