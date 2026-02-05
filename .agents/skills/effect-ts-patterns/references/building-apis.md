# Building APIs Patterns (13 patterns)

HTTP servers, middleware, authentication, validation, OpenAPI.

## Table of Contents
- [Basic Server](#basic-server)
- [Routing](#routing)
- [Request Handling](#request-handling)
- [Response Building](#response-building)
- [Middleware](#middleware)
- [Authentication](#authentication)
- [Error Handling](#error-handling)
- [OpenAPI](#openapi)

---

## Basic Server

### Create HTTP Server
```typescript
import { HttpServer, HttpRouter, HttpServerResponse } from "@effect/platform"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Layer } from "effect"

const router = HttpRouter.empty.pipe(
  HttpRouter.get("/", HttpServerResponse.text("Hello, World!"))
)

const app = router.pipe(HttpServer.serve())

const ServerLive = NodeHttpServer.layer(() => createServer(), { port: 3000 })

NodeRuntime.runMain(Layer.launch(Layer.provide(app, ServerLive)))
```

---

## Routing

### Define Routes
```typescript
const router = HttpRouter.empty.pipe(
  HttpRouter.get("/health", HttpServerResponse.json({ status: "ok" })),
  HttpRouter.get("/users", listUsers),
  HttpRouter.get("/users/:id", getUser),
  HttpRouter.post("/users", createUser),
  HttpRouter.put("/users/:id", updateUser),
  HttpRouter.delete("/users/:id", deleteUser)
)
```

### Extract Path Parameters
```typescript
const getUser = Effect.gen(function* () {
  const params = yield* HttpRouter.params
  const userId = params.id

  const user = yield* UserService.findById(userId)

  return HttpServerResponse.json(user)
})
```

### Extract Query Parameters
```typescript
const listUsers = Effect.gen(function* () {
  const url = yield* HttpServerRequest.schemaSearchParams(
    Schema.Struct({
      page: Schema.optional(Schema.NumberFromString).pipe(
        Schema.withDefault(() => 1)
      ),
      limit: Schema.optional(Schema.NumberFromString).pipe(
        Schema.withDefault(() => 20)
      )
    })
  )

  const users = yield* UserService.list({ page: url.page, limit: url.limit })

  return HttpServerResponse.json(users)
})
```

---

## Request Handling

### Validate Request Body
```typescript
const CreateUserBody = Schema.Struct({
  email: Schema.String.pipe(Schema.pattern(/@/)),
  name: Schema.String.pipe(Schema.minLength(1)),
  role: Schema.optional(Schema.Literal("admin", "user"))
})

const createUser = Effect.gen(function* () {
  const body = yield* HttpServerRequest.schemaBodyJson(CreateUserBody)

  const user = yield* UserService.create(body)

  return HttpServerResponse.json(user, { status: 201 })
})
```

### Handle File Uploads
```typescript
const uploadFile = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const formData = yield* request.multipart

  const file = formData.get("file")
  if (!file || file.type !== "File") {
    return yield* Effect.fail(new ValidationError({ field: "file", message: "Required" }))
  }

  const path = yield* saveFile(file)

  return HttpServerResponse.json({ path })
})
```

---

## Response Building

### JSON Response
```typescript
HttpServerResponse.json({ id: "123", name: "Alice" })
HttpServerResponse.json(data, { status: 201 })
HttpServerResponse.json(data, {
  headers: HttpHeaders.fromInput({ "X-Request-Id": requestId })
})
```

### Text Response
```typescript
HttpServerResponse.text("Hello")
HttpServerResponse.html("<h1>Hello</h1>")
```

### Redirect
```typescript
HttpServerResponse.redirect("/login", { status: 302 })
```

### Stream Response
```typescript
const downloadFile = Effect.gen(function* () {
  const stream = yield* readFileStream(path)

  return HttpServerResponse.stream(stream, {
    contentType: "application/octet-stream",
    headers: HttpHeaders.fromInput({
      "Content-Disposition": `attachment; filename="${filename}"`
    })
  })
})
```

---

## Middleware

### Create Middleware
```typescript
const LoggingMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const start = Date.now()

    yield* Effect.log(`--> ${request.method} ${request.url}`)

    const response = yield* app

    yield* Effect.log(`<-- ${response.status} (${Date.now() - start}ms)`)

    return response
  })
)
```

### Compose Middleware
```typescript
const router = HttpRouter.empty.pipe(
  HttpRouter.get("/", handler),
  HttpRouter.use(LoggingMiddleware),
  HttpRouter.use(CorsMiddleware),
  HttpRouter.use(AuthMiddleware)
)
```

### CORS Middleware
```typescript
const CorsMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const response = yield* app

    return response.pipe(
      HttpServerResponse.setHeaders({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      })
    )
  })
)

// Handle preflight
const router = HttpRouter.empty.pipe(
  HttpRouter.options("*", HttpServerResponse.empty({ status: 204 })),
  // ... other routes
  HttpRouter.use(CorsMiddleware)
)
```

### Rate Limiting
```typescript
const RateLimitMiddleware = (limit: number, window: Duration.Duration) =>
  HttpMiddleware.make((app) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const ip = request.headers["x-forwarded-for"] ?? "unknown"

      const rateLimiter = yield* RateLimiter
      const allowed = yield* rateLimiter.check(ip, limit, window)

      if (!allowed) {
        return HttpServerResponse.json(
          { error: "Too many requests" },
          { status: 429 }
        )
      }

      return yield* app
    })
  )
```

---

## Authentication

### JWT Authentication
```typescript
const AuthMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const auth = request.headers["authorization"]

    if (!auth?.startsWith("Bearer ")) {
      return HttpServerResponse.json(
        { error: "Missing authorization" },
        { status: 401 }
      )
    }

    const token = auth.slice(7)
    const session = yield* verifyJwt(token).pipe(
      Effect.catchAll(() =>
        Effect.fail(HttpServerResponse.json(
          { error: "Invalid token" },
          { status: 401 }
        ))
      )
    )

    // Add session to context
    return yield* app.pipe(
      Effect.provideService(Session, session)
    )
  })
)
```

### Protected Routes
```typescript
const protectedRoutes = HttpRouter.empty.pipe(
  HttpRouter.get("/me", getCurrentUser),
  HttpRouter.get("/settings", getSettings),
  HttpRouter.use(AuthMiddleware)
)

const publicRoutes = HttpRouter.empty.pipe(
  HttpRouter.post("/login", login),
  HttpRouter.post("/register", register)
)

const router = HttpRouter.empty.pipe(
  HttpRouter.mount("/api", protectedRoutes),
  HttpRouter.mount("/auth", publicRoutes)
)
```

---

## Error Handling

### Map Domain Errors to HTTP
```typescript
const handleApiErrors = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.map((data) => HttpServerResponse.json(data)),
    Effect.catchTags({
      NotFound: (e) =>
        Effect.succeed(HttpServerResponse.json(
          { error: `${e.resourceType} not found`, id: e.id },
          { status: 404 }
        )),
      ValidationError: (e) =>
        Effect.succeed(HttpServerResponse.json(
          { error: "Validation failed", field: e.field, message: e.message },
          { status: 400 }
        )),
      Unauthorized: () =>
        Effect.succeed(HttpServerResponse.json(
          { error: "Unauthorized" },
          { status: 401 }
        ))
    }),
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        yield* Effect.logError("Unhandled error", error)
        return HttpServerResponse.json(
          { error: "Internal server error" },
          { status: 500 }
        )
      })
    )
  )
```

### Use in Routes
```typescript
const getUser = handleApiErrors(
  Effect.gen(function* () {
    const params = yield* HttpRouter.params
    const users = yield* UserService
    const user = yield* users.findById(params.id)

    return Option.match(user, {
      onNone: () => Effect.fail(new NotFoundError({ resourceType: "User", id: params.id })),
      onSome: Effect.succeed
    })
  }).pipe(Effect.flatten)
)
```

---

## OpenAPI

### Generate OpenAPI Spec
```typescript
import { OpenApi } from "@effect/platform"

const GetUserParams = Schema.Struct({
  id: Schema.String.pipe(Schema.description("User ID"))
})

const UserResponse = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String
})

const getUserEndpoint = HttpApiEndpoint.get("getUser", "/users/:id").pipe(
  HttpApiEndpoint.setPath(GetUserParams),
  HttpApiEndpoint.setSuccess(UserResponse)
)

const usersGroup = HttpApiGroup.make("users").pipe(
  HttpApiGroup.add(getUserEndpoint)
)

const api = HttpApi.make("My API").pipe(
  HttpApi.addGroup(usersGroup)
)

// Serve OpenAPI JSON at /docs
const docsRoute = HttpRouter.get(
  "/docs",
  HttpServerResponse.json(OpenApi.fromApi(api))
)
```
