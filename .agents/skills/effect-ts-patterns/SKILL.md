---
name: effect-ts-patterns
description: >-
  Comprehensive guide to Effect-TS patterns for building robust TypeScript applications.
  Use when: (1) Writing Effect-TS code - effects, streams, layers, services, (2) Handling
  errors with typed errors and recovery, (3) Managing concurrency with fibers, queues,
  deferred, (4) Working with Schema for validation, (5) Building APIs or data pipelines,
  (6) Managing resources safely, (7) Understanding Effect fundamentals vs Promise/async-await.
  Triggers: "Effect", "effect-ts", "Effect.gen", "Effect.runPromise", "Schema", "Layer",
  "Service", "fiber", "Deferred", "Stream", "Chunk", "Option", "Either", "typed errors".
---

# Effect-TS Patterns

304 practical patterns for Effect-TS organized by domain.

## Quick Start

For new Effect users, start with these foundational patterns in order:

1. **Effects are Lazy** - Effects describe computation, execute with `runPromise`/`runSync`
2. **Three Channels (A, E, R)** - Success value, Error type, Requirements
3. **Use .pipe()** - Chain operations fluently
4. **Effect.gen** - Write sequential code like async/await with `yield*`
5. **Option/Either** - Model optional values and failures explicitly
6. **Schema.decode** - Validate and parse unknown data

## Pattern Categories

### Core Concepts (55 patterns)

Fundamentals: generators, pipes, dependencies, data types.
See: [references/core-concepts.md](references/core-concepts.md)

### Error Management (19 patterns)

Typed errors, recovery with catchTag/catchAll, retries, structured logging.
See: [references/error-management.md](references/error-management.md)

### Concurrency (24 patterns)

Fibers, parallel execution, Deferred, Semaphore, Queue, PubSub, Ref.
See: [references/concurrency.md](references/concurrency.md)

### Streams (18 patterns)

Process data sequences: map, filter, merge, backpressure, sinks.
See: [references/streams.md](references/streams.md)

### Schema (77 patterns)

Validation: primitives, objects, arrays, unions, transformations, async validation.
See: [references/schema.md](references/schema.md)

### Domain Modeling (15 patterns)

Branded types, tagged errors, Option for missing values, Schema contracts.
See: [references/domain-modeling.md](references/domain-modeling.md)

### Building APIs (13 patterns)

HTTP servers, middleware, authentication, validation, OpenAPI.
See: [references/building-apis.md](references/building-apis.md)

### Data Pipelines (14 patterns)

Stream processing, pagination, batching, fan-out, backpressure.
See: [references/data-pipelines.md](references/data-pipelines.md)

### Resource Management (8 patterns)

acquireRelease, Scope, Layer composition, pooling, timeouts.
See: [references/resource-management.md](references/resource-management.md)

### HTTP Requests (10 patterns)

HTTP client, timeouts, caching, response parsing, retries.
See: [references/http-requests.md](references/http-requests.md)

### Testing (10 patterns)

Unit testing, service mocking, property-based testing, streams.
See: [references/testing.md](references/testing.md)

### Observability (13 patterns)

Logging, metrics, tracing, spans, OpenTelemetry, Prometheus.
See: [references/observability.md](references/observability.md)

### Scheduling (6 patterns)

Fixed intervals, cron, debounce/throttle, retry chains, circuit breakers.
See: [references/scheduling.md](references/scheduling.md)

### Platform (8 patterns)

Filesystem, terminal I/O, command execution, environment variables.
See: [references/platform.md](references/platform.md)

## Common Tasks

### Create an Effect

```typescript
// From a value
const succeed = Effect.succeed(42);

// From a failure
const fail = Effect.fail(new Error("oops"));

// From sync code that might throw
const trySync = Effect.try(() => JSON.parse(data));

// From a Promise
const tryPromise = Effect.tryPromise(() => fetch(url));

// Sequential code with generators
const program = Effect.gen(function* () {
  const a = yield* getA();
  const b = yield* getB(a);
  return a + b;
});
```

### Handle Errors

```typescript
// Catch specific tagged error
effect.pipe(Effect.catchTag("NotFound", (e) => Effect.succeed(defaultValue)));

// Catch multiple tagged errors
effect.pipe(
  Effect.catchTags({
    NotFound: () => Effect.succeed(null),
    NetworkError: (e) => Effect.retry(effect, Schedule.exponential("1 second")),
  }),
);

// Catch all errors
effect.pipe(Effect.catchAll((error) => Effect.succeed(fallback)));
```

### Define Typed Errors

```typescript
import { Data } from "effect";

class NotFoundError extends Data.TaggedError("NotFound")<{
  readonly id: string;
}> {}

class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
  readonly message: string;
}> {}
```

### Create a Service

```typescript
class UserService extends Effect.Service<UserService>()("UserService", {
  effect: Effect.gen(function* () {
    const db = yield* Database;
    return {
      findById: (id: string) => db.query(`SELECT * FROM users WHERE id = ?`, [id]),
      create: (user: User) => db.insert("users", user),
    };
  }),
}) {}

// Provide via Layer
const program = Effect.gen(function* () {
  const users = yield* UserService;
  return yield* users.findById("123");
});

Effect.runPromise(program.pipe(Effect.provide(UserService.Default)));
```

### Validate with Schema

```typescript
import { Schema } from "effect";

const User = Schema.Struct({
  id: Schema.String,
  email: Schema.String.pipe(Schema.pattern(/@/)),
  age: Schema.Number.pipe(Schema.int(), Schema.positive()),
});

// Decode unknown data
const parseUser = Schema.decodeUnknown(User);
const result = Effect.runSync(parseUser({ id: "1", email: "a@b.com", age: 25 }));
```

### Run Effects in Parallel

```typescript
// All in parallel
const results = yield * Effect.all([effectA, effectB, effectC], { concurrency: "unbounded" });

// With concurrency limit
const results = yield * Effect.forEach(items, processItem, { concurrency: 10 });

// Race for first success
const fastest = yield * Effect.race(effectA, effectB);
```

### Use Streams

```typescript
import { Stream } from "effect";

const pipeline = Stream.fromIterable([1, 2, 3, 4, 5]).pipe(
  Stream.filter((n) => n % 2 === 0),
  Stream.map((n) => n * 2),
  Stream.runCollect,
);
// Chunk(4, 8)
```

## Key Principles

1. **Effects are lazy blueprints** - Nothing executes until `run*`
2. **Errors are typed** - Use `Data.TaggedError` for exhaustive handling
3. **Dependencies via R channel** - Services injected through Layers
4. **Composition over inheritance** - Pipe operators, don't subclass
5. **Resources are scoped** - `acquireRelease` guarantees cleanup
6. **Concurrency is safe** - Ref for state, Deferred for coordination
