---
name: effect-http-api
description: "Use when building HTTP APIs with Effect HttpApi — defining typed endpoints and groups, implementing handlers with Effect services, mapping service errors to HTTP errors with proper status codes, adding SSE streaming endpoints, implementing auth middleware with typed provides, generating OpenAPI documentation, and serving production HTTP servers. MUST load before writing any HttpApi endpoint or handler."
---

# Effect HttpApi

## Overview

Effect HttpApi (`effect/unstable/httpapi`) is a schema-first HTTP framework. Define your API once with Effect Schema — you get type-safe handlers, automatic request/response validation, generated OpenAPI documentation, and a fully typed client. It's the HTTP layer that sits on top of the Effect service architecture (`Context.Tag` + `Layer`).

This skill covers the patterns that Effect's own docs (fragmented across a separate wiki and marked `unstable`) don't connect: the full lifecycle from service definition to HTTP endpoint with typed error mapping, SSE streaming, middleware/auth, and OpenAPI generation.

## When to Use

- Building HTTP APIs on top of an Effect service layer
- Replacing Express/Hono/Fastify in an Effect-based codebase
- Generating OpenAPI specs from TypeScript types
- Building type-safe client/server HTTP applications

## When NOT to Use

- Simple proxies or thin pass-throughs (Express with a few routes is faster)
- Frontend-only applications (React, Vue, etc.)
- Projects not using Effect at all

---

## Part 1: The Full Lifecycle

An Effect HttpApi application has four layers:

```
1. Schema types           (effect-schema skill)
2. Effect services        (opencode-ts-service skill: Context.Tag + Layer)
3. HttpApi definition     (endpoints + groups + API)
4. HttpApi handlers       (implement endpoints using Effect services)
5. Serve                  (wire everything, start server)
```

This skill covers steps 3-5. Steps 1-2 are covered by the companion skills.

---

## Part 2: Defining the API

### Endpoints and Groups

```typescript
// src/api/users.ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Schema } from "effect"

// Response schemas (defined in the service module or here for API-specific shapes)
class User extends Schema.Class<User>("User")({
  id: Schema.Number,
  name: Schema.String,
  email: Schema.String,
}) {}

// Endpoint group — a collection of related endpoints
class UsersApi extends HttpApiGroup.make("users")
  // GET /users — list all users
  .add(
    HttpApiEndpoint.get("list", "/users")(
      Schema.Array(User)        // success response
    )
  )
  // GET /users/:id — get by ID
  .add(
    HttpApiEndpoint.get("getById", "/users/:id")(
      User,                    // success response
      { path: Schema.Struct({ id: Schema.NumberFromString }) }  // path params
    )
  )
  // POST /users — create
  .add(
    HttpApiEndpoint.post("create", "/users")(
      User,
      { body: Schema.Struct({ name: Schema.String, email: Schema.String }) }
    )
  )
  // DELETE /users/:id — delete
  .add(
    HttpApiEndpoint.del("remove", "/users/:id")(
      Schema.Void,
      { path: Schema.Struct({ id: Schema.NumberFromString }) }
    )
  )
{}
```

### Available Endpoint Methods

```typescript
HttpApiEndpoint.get("name", "/path")(successSchema, options?)
HttpApiEndpoint.post("name", "/path")(successSchema, options?)
HttpApiEndpoint.put("name", "/path")(successSchema, options?)
HttpApiEndpoint.patch("name", "/path")(successSchema, options?)
HttpApiEndpoint.del("name", "/path")(successSchema, options?)
```

Options can include:
- `path` — path parameters as a Struct
- `body` — request body schema
- `headers` — request headers schema
- `query` — query parameters schema
- `middleware` — middleware tags to apply

### Composing Groups into an API

```typescript
// src/api/index.ts
import { HttpApi } from "effect/unstable/httpapi"

class SystemApi extends HttpApiGroup.make("system")
  .add(HttpApiEndpoint.get("health", "/health")(Schema.Void))
{}

export class Api extends HttpApi.make("my-api")
  .add(UsersApi)
  .add(SystemApi)
{}
```

---

## Part 3: Implementing Handlers

### The Handler Pattern

```typescript
// src/api/users-handlers.ts
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "./index"

export const UsersApiHandlers = HttpApiBuilder.group(
  Api,
  "users",
  Effect.fn(function* (handlers) {
    // Access Effect services via yield*
    const userService = yield* UserService

    return handlers
      .handle("list", () =>
        userService.listUsers()
      )
      .handle("getById", ({ path }) =>
        userService.getUserById(path.id)
      )
      .handle("create", ({ body }) =>
        userService.createUser(body.name, body.email)
      )
      .handle("remove", ({ path }) =>
        userService.deleteUser(path.id)
      )
  })
)
```

`Effect.fn` names the handler for tracing. The handler parameters are typed automatically from the endpoint definition — path params, body, headers, and query are all type-safe.

### Accessing Request Data

```typescript
.handle("getById", ({ path, headers, query }) => {
  // path.id    — typed from path schema
  // headers    — typed from headers schema
  // query      — typed from query schema
})
```

---

## Part 4: Error Mapping (Service Errors -> HTTP Errors)

This is the most important HttpApi pattern and the one least documented by Effect.

### The Problem

Your Effect service returns typed errors:

```typescript
class UserNotFound extends Schema.TaggedErrorClass<UserNotFound>()(
  "UserNotFound",
  { userId: Schema.Number }
) {}
class ValidationFailed extends Schema.TaggedErrorClass<ValidationFailed>()(
  "ValidationFailed",
  { message: Schema.String }
) {}

// Service method returns Effect<User, UserNotFound | ValidationFailed, ...>
```

But HTTP doesn't understand `UserNotFound` — it needs HTTP status codes and wire bodies.

### Solution: Map Errors at the HTTP Boundary

```typescript
// src/api/users-handlers.ts
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"

export const UsersApiHandlers = HttpApiBuilder.group(
  Api,
  "users",
  Effect.fn(function* (handlers) {
    const userService = yield* UserService

    return handlers
      .handle("getById", ({ path }) =>
        userService.getUserById(path.id).pipe(
          // Map service errors to HTTP errors
          Effect.catchTags({
            UserNotFound: () =>
              Effect.fail(HttpApiBuilder.notFound("User not found")),
            ValidationFailed: (e) =>
              Effect.fail(HttpApiBuilder.badRequest(e.message)),
          })
        )
      )
  })
)
```

### Built-in HTTP Error Factories

```typescript
HttpApiBuilder.notFound("User not found")            // 404
HttpApiBuilder.badRequest("Invalid input")            // 400
HttpApiBuilder.unauthorized("Missing token")          // 401
HttpApiBuilder.forbidden("Insufficient permissions")  // 403
HttpApiBuilder.internalServerError("Something broke") // 500
HttpApiBuilder.conflict("Resource exists")            // 409
HttpApiBuilder.tooManyRequests("Rate limited")        // 429
```

### Declaring Errors on Endpoints (for OpenAPI)

To get errors in the generated OpenAPI spec, declare them on the endpoint:

```typescript
import { HttpApiEndpoint } from "effect/unstable/httpapi"
import { Schema } from "effect"

// 1. Define HTTP error schemas
class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "NotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 }  // ← this maps to HTTP status
) {}

class BadRequestError extends Schema.TaggedErrorClass<BadRequestError>()(
  "BadRequestError",
  { message: Schema.String },
  { httpApiStatus: 400 }
) {}

// 2. Declare on endpoint
class UsersApi extends HttpApiGroup.make("users")
  .add(
    HttpApiEndpoint.get("getById", "/users/:id")(
      User,
      { path: Schema.Struct({ id: Schema.NumberFromString }) },
      { error: [NotFoundError, BadRequestError] }  // ← declared errors
    )
  )
{}
```

### Mapping to Declared Errors

```typescript
.handle("getById", ({ path }) =>
  userService.getUserById(path.id).pipe(
    Effect.catchTags({
      UserNotFound: () => Effect.fail(new NotFoundError({ message: "User not found" })),
      ValidationFailed: (e) => Effect.fail(new BadRequestError({ message: e.message })),
    })
  )
)
```

**Rule:** Keep service errors and HTTP errors as separate classes. Service errors carry internal data (retry hints, low-level causes). HTTP errors carry public wire bodies. Never leak internal error data to API clients.

---

## Part 5: SSE Streaming

Effect HttpApi supports streaming responses natively via `Stream`:

```typescript
// Define a streaming endpoint
class ChatApi extends HttpApiGroup.make("chat")
  .add(
    HttpApiEndpoint.post("completions", "/chat/completions")(
      HttpApiEndpoint.EventStream,  // ← signals SSE response
      { body: Schema.Struct({ prompt: Schema.String }) }
    )
  )
{}

// Implement
const ChatApiHandlers = HttpApiBuilder.group(
  Api,
  "chat",
  Effect.fn(function* (handlers) {
    return handlers
      .handle("completions", ({ body }) =>
        Effect.succeed(
          HttpApiBuilder.EventStream(
            generateTokens(body.prompt).pipe(
              Stream.map((token) => ({ data: JSON.stringify({ text: token }) }))
            )
          )
        )
      )
  })
)
```

The `EventStream` wrapper takes a `Stream` of events and encodes them as SSE. Each event object is serialized and sent as `data: {...}\n\n`.

---

## Part 6: Middleware (Auth)

### Defining Middleware

```typescript
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { Schema } from "effect"

// Define what the middleware provides
class Auth extends HttpApiMiddleware.Tag<Auth>()("Auth", {
  failure: Schema.Struct({
    _tag: Schema.Literal("Unauthorized"),
    message: Schema.String,
  }),
  provides: Schema.Struct({
    userId: Schema.String,
    orgId: Schema.String,
  }),
}) {}
```

### Applying Middleware to Endpoints

```typescript
class UsersApi extends HttpApiGroup.make("users")
  .add(
    HttpApiEndpoint.get("profile", "/profile")(
      User,
      { middleware: Auth }  // ← requires Auth middleware
    )
  )
{}
```

### Implementing Middleware (Server-Side)

```typescript
const AuthServer = HttpApiMiddleware.layerServer(
  Auth,
  Effect.fn(function* ({ next, request }) {
    const token = request.headers.get("authorization")
    if (!token) {
      return yield* Effect.fail({
        _tag: "Unauthorized" as const,
        message: "Missing authorization header",
      })
    }
    const decoded = yield* verifyToken(token)
    return yield* next({ userId: decoded.sub, orgId: decoded.org })
  })
)
```

`provides` fields (userId, orgId) are available to downstream handlers:

```typescript
.handle("profile", ({ middleware }) => {
  // middleware.userId — provided by Auth middleware
  // middleware.orgId  — provided by Auth middleware
  return userService.getProfile(middleware.userId)
})
```

### Applying Middleware to Client

```typescript
const AuthClient = HttpApiMiddleware.layerClient(
  Auth,
  Effect.fn(function* ({ next, request }) {
    const token = yield* getToken()
    const modified = HttpClientRequest.bearerToken(request, token)
    return yield* next(modified)
  })
)
```

---

## Part 7: OpenAPI Documentation

### Auto-Generated OpenAPI

```typescript
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpApiScalar } from "effect/unstable/httpapi"

const ApiRoutes = HttpApiBuilder.layer(Api, {
  openapiPath: "/openapi.json",
  info: {
    title: "My API",
    version: "1.0.0",
    description: "A type-safe API built with Effect",
  },
})

// Serve Scalar UI for interactive docs
const DocsRoute = HttpApiScalar.layer(Api, {
  path: "/docs",
})

const AllRoutes = Layer.mergeAll(ApiRoutes, DocsRoute)
```

Every schema, error, and endpoint becomes part of the OpenAPI spec automatically.

### OpenAPI Customization

```typescript
HttpApiBuilder.layer(Api, {
  openapiPath: "/openapi.json",
  info: {
    title: "My API",
    version: "1.0.0",
  },
  servers: [{ url: "https://api.example.com" }],
})
```

Error schemas with `{ httpApiStatus: 404 }` annotations become OpenAPI error responses with the correct status code.

---

## Part 8: The Typed Client

```typescript
import { HttpApiClient } from "effect/unstable/httpapi"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { Effect, Layer, Schedule } from "effect"

class ApiClient extends ServiceMap.Service<
  ApiClient,
  HttpApiClient.ForApi<typeof Api>
>()("app/ApiClient") {
  static readonly layer = Layer.effect(
    ApiClient,
    HttpApiClient.make(Api, {
      transformClient: (client) =>
        client.pipe(
          HttpClient.mapRequest(
            HttpClientRequest.prependUrl("http://localhost:3000")
          ),
          HttpClient.retryTransient({
            schedule: Schedule.exponential(100),
            times: 3,
          })
        )
    })
  ).pipe(
    Layer.provide(FetchHttpClient.layer)
  )
}

// Usage
const program = Effect.gen(function* () {
  const client = yield* ApiClient
  const users = yield* client.users.list()
  const user = yield* client.users.getById({ path: { id: 123 } })
})
```

Every call is fully typed — path params, body, query, headers, and response.

---

## Part 9: Serving the API

### Production Server

```typescript
// src/main.ts
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Layer } from "effect"
import { createServer } from "node:http"

// Compose all handler layers
const HandlerLayer = Layer.mergeAll(
  UsersApiHandlers,
  SystemApiHandlers,
)

// Build the API routes
const ApiRoutes = HttpApiBuilder.layer(Api, {
  openapiPath: "/openapi.json",
}).pipe(
  Layer.provide(HandlerLayer),
  Layer.provide(AppServices),   // your Effect service layers
)

// Serve
const server = HttpRouter.serve(ApiRoutes).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 }))
)

Layer.launch(server).pipe(NodeRuntime.runMain)
```

### Server Lifecycle

`Layer.launch` starts the server and waits for SIGTERM/SIGINT. On shutdown, it:
1. Stops accepting new connections
2. Drains in-flight requests
3. Releases all Effect-scoped resources (DB connections, file handles, etc.)

No manual shutdown handling needed — Effect's `Scope` handles it.

---

## Part 10: Testing

### Testing Handlers

```typescript
import { it } from "@effect/vitest"

it.effect("should get user by id", () =>
  Effect.gen(function* () {
    const handler = yield* UsersApiHandlers
    const result = yield* handler.handlers.getById({ path: { id: 1 } })
    expect(result.id).toBe(1)
  })
)
```

### Testing via HTTP Client

```typescript
import { HttpRouter } from "effect/unstable/http"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Layer, Effect } from "effect"

it.effect("GET /users returns 200", () =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient.pipe(
      HttpClient.mapRequest(
        HttpClientRequest.prependUrl("http://localhost:3000")
      )
    )
    const response = yield* client.get("/users")
    const body = yield* response.json
    expect(Array.isArray(body)).toBe(true)
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        ApiTestLayer,  // replace real services with test layers
        HttpRouter.serve(ApiRoutes),
        NodeHttpServer.layer(createServer, { port: 0 }),
      )
    )
  )
)
```

---

## Common Mistakes

| Mistake | Problem | Fix |
|---|---|---|
| Service errors leaked in HTTP responses | Internal data exposed to clients | Map to separate HTTP error schemas with public bodies |
| No `httpApiStatus` annotation on error schemas | OpenAPI shows wrong status codes | Add `{ httpApiStatus: 404 }` |
| Hardcoded error messages everywhere | Inconsistent API responses | Use `HttpApiBuilder.notFound()`, `badRequest()`, etc. |
| Giant handler with all endpoints | Hard to test, maintain | One handler group per domain (UsersApi, PaymentsApi, etc.) |
| Using `HttpApi` for non-HTTP services | Over-engineering a CLI or worker | Only use HttpApi for HTTP endpoints |
| Not using `Effect.fn` for handlers | No span names in traces | `Effect.fn(function* (handlers) { ... })` |
| Manually constructing error responses | Wrong status code, wrong body | Use `HttpApiBuilder.*` error factories |
| Catch-all error handlers | Swallows real bugs | Use typed catchTags, let defects propagate as 500s |

## Red Flags — STOP and Fix

- Service error types leaked into HTTP error schemas — separate them
- No `httpApiStatus` on error schemas — OpenAPI will be wrong
- `any` in request/response types — HttpApi should never use any
- Manually setting status codes in handlers — use HttpApiBuilder.*
- Giant `catchAll` that hides defects — defects should crash the fiber, not be swallowed
- SSE streams without proper typing — `HttpApiEndpoint.EventStream` handles the types

## Quick Reference

```typescript
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { Schema, Effect, Layer, Stream } from "effect"

// 1. Define API
class MyApi extends HttpApiGroup.make("items")
  .add(HttpApiEndpoint.get("list", "/items")(Schema.Array(ItemSchema)))
  .add(HttpApiEndpoint.get("get", "/items/:id")(ItemSchema,
    { path: Schema.Struct({ id: Schema.NumberFromString }) }
  ))
{}
class Api extends HttpApi.make("api").add(MyApi) {}

// 2. Implement handlers
const Handlers = HttpApiBuilder.group(Api, "items",
  Effect.fn(function* (h) {
    const svc = yield* ItemService
    return h
      .handle("list", () => svc.list())
      .handle("get", ({ path }) => svc.get(path.id).pipe(
        Effect.catchTags({ NotFound: () => Effect.fail(HttpApiBuilder.notFound()) })
      ))
  })
)

// 3. Serve
const Routes = HttpApiBuilder.layer(Api).pipe(
  Layer.provide([Handlers, AppServices])
)
HttpRouter.serve(Routes).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
  Layer.launch,
  NodeRuntime.runMain,
)
```
