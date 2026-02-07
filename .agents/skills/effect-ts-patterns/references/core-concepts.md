# Core Concepts Patterns (55 patterns)

Fundamental Effect-TS patterns for generators, pipes, dependencies, and data types.

## Table of Contents

- [Effect Fundamentals](#effect-fundamentals)
- [Creating Effects](#creating-effects)
- [Transforming Effects](#transforming-effects)
- [Data Types](#data-types)
- [Configuration](#configuration)
- [Dependencies & Layers](#dependencies--layers)

---

## Effect Fundamentals

### Effects are Lazy Blueprints

An Effect is not a value or Promise. It's a lazy, immutable blueprint describing a computation. Nothing executes until passed to a runtime (`Effect.runPromise`, `Effect.runSync`).

```typescript
// This does NOT execute - just defines
const program = Effect.gen(function* () {
  yield* Effect.log("Hello");
  return 42;
});

// This EXECUTES
Effect.runPromise(program);
```

**Anti-pattern**: Assuming Effect behaves like Promise (which executes immediately).

### The Three Effect Channels (A, E, R)

`Effect<A, E, R>` has three type parameters:

- **A** (Success): The value produced on success
- **E** (Error): The typed error(s) that can occur
- **R** (Requirements): Dependencies needed from context

```typescript
// Effect<number, never, never> - succeeds with number, can't fail, no deps
const pure = Effect.succeed(42)

// Effect<User, NotFoundError, UserService> - needs UserService, may fail
const getUser: Effect<User, NotFoundError, UserService> = ...
```

### Use .pipe() for Composition

Chain operations in a readable top-to-bottom sequence:

```typescript
const result = someEffect.pipe(
  Effect.map((x) => x * 2),
  Effect.flatMap((x) => fetchData(x)),
  Effect.catchTag("NotFound", () => Effect.succeed(null)),
  Effect.timeout("5 seconds"),
);
```

### Write Sequential Code with Effect.gen

Use generators for async/await-like syntax with `yield*`:

```typescript
const program = Effect.gen(function* () {
  const user = yield* getUser(id);
  const posts = yield* getPosts(user.id);
  yield* Effect.log(`Found ${posts.length} posts`);
  return { user, posts };
});
```

---

## Creating Effects

### From Values

```typescript
Effect.succeed(42); // Effect<number, never, never>
Effect.fail(new Error("oops")); // Effect<never, Error, never>
Effect.void; // Effect<void, never, never>
```

### From Synchronous Code

```typescript
// Non-throwing sync code
Effect.sync(() => Date.now());

// Sync code that might throw
Effect.try(() => JSON.parse(data));

// With error mapping
Effect.try({
  try: () => JSON.parse(data),
  catch: (e) => new ParseError(String(e)),
});
```

### From Async Code

```typescript
// Promise that might reject
Effect.tryPromise(() => fetch(url));

// With error mapping
Effect.tryPromise({
  try: () => fetch(url),
  catch: (e) => new NetworkError(String(e)),
});
```

### From Nullable/Option/Either

```typescript
Effect.fromNullable(maybeValue); // None if null/undefined
Option.fromNullable(maybeValue); // Option<A>
```

---

## Transforming Effects

### map - Transform Success Value

```typescript
Effect.succeed(5).pipe(Effect.map((n) => n * 2)); // Effect<10>
```

### flatMap - Chain Effectful Operations

```typescript
getUser(id).pipe(Effect.flatMap((user) => getPosts(user.id)));
```

### tap - Side Effects Without Changing Value

```typescript
getUser(id).pipe(Effect.tap((user) => Effect.log(`Found: ${user.name}`)));
```

### andThen - Sequence Effects

```typescript
Effect.succeed(1).pipe(Effect.andThen(Effect.succeed(2))); // Effect<2>
```

### Conditional Combinators

```typescript
// Effect.if
Effect.if(condition, {
  onTrue: () => doA(),
  onFalse: () => doB(),
});

// Effect.when - run only if true
Effect.when(shouldLog, () => Effect.log("Condition met"));
```

### Filtering

```typescript
Effect.succeed(5).pipe(
  Effect.filterOrFail(
    (n) => n > 0,
    () => new NegativeError(),
  ),
);
```

---

## Data Types

### Option - Optional Values

```typescript
import { Option } from "effect";

Option.some(42); // Option<number>
Option.none(); // Option<never>

Option.fromNullable(value); // None if null/undefined

// Pattern match
Option.match(opt, {
  onNone: () => "missing",
  onSome: (v) => `found: ${v}`,
});
```

### Either - Success or Failure

```typescript
import { Either } from "effect";

Either.right(42); // Either<never, number>
Either.left("error"); // Either<string, never>

Either.match(result, {
  onLeft: (e) => `Error: ${e}`,
  onRight: (v) => `Value: ${v}`,
});
```

### Chunk - High-Performance Collections

```typescript
import { Chunk } from "effect";

const chunk = Chunk.fromIterable([1, 2, 3]);
Chunk.map(chunk, (n) => n * 2);
Chunk.filter(chunk, (n) => n > 1);
```

### Ref - Mutable State

```typescript
const program = Effect.gen(function* () {
  const counter = yield* Ref.make(0);
  yield* Ref.update(counter, (n) => n + 1);
  return yield* Ref.get(counter);
});
```

### Duration - Time Spans

```typescript
import { Duration } from "effect";

Duration.seconds(30);
Duration.minutes(5);
Duration.millis(100);
("5 seconds"); // String literal also works
```

### Data.struct - Value Equality

```typescript
import { Data } from "effect";

const point1 = Data.struct({ x: 1, y: 2 });
const point2 = Data.struct({ x: 1, y: 2 });
Equal.equals(point1, point2); // true (structural equality)
```

### Data.TaggedError - Typed Errors

```typescript
class NotFoundError extends Data.TaggedError("NotFound")<{
  readonly id: string;
}> {}

class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly url: string;
  readonly code: number;
}> {}
```

---

## Configuration

### Define Config Schema

```typescript
import { Config } from "effect";

const AppConfig = Config.all({
  port: Config.number("PORT").pipe(Config.withDefault(3000)),
  host: Config.string("HOST").pipe(Config.withDefault("localhost")),
  apiKey: Config.redacted("API_KEY"),
});
```

### Access Config in Effect

```typescript
const program = Effect.gen(function* () {
  const config = yield* AppConfig;
  yield* Effect.log(`Starting on ${config.host}:${config.port}`);
});
```

### Provide Config via Layer

```typescript
const ConfigLayer = Config.layer(AppConfig);
Effect.runPromise(program.pipe(Effect.provide(ConfigLayer)));
```

---

## Dependencies & Layers

### Define a Service

```typescript
class Database extends Effect.Service<Database>()("Database", {
  effect: Effect.gen(function* () {
    const config = yield* DatabaseConfig;
    return {
      query: (sql: string) => Effect.tryPromise(() => runQuery(sql)),
      close: () => Effect.sync(() => pool.end()),
    };
  }),
}) {}
```

### Use a Service

```typescript
const program = Effect.gen(function* () {
  const db = yield* Database;
  return yield* db.query("SELECT * FROM users");
});
```

### Create Layers

```typescript
// Simple layer
const DatabaseLive = Layer.succeed(Database, { query: ..., close: ... })

// Effect-based layer
const DatabaseLive = Layer.effect(Database, Effect.gen(function* () {
  // initialization
  return { query: ..., close: ... }
}))

// Scoped layer (with cleanup)
const DatabaseLive = Layer.scoped(Database, Effect.acquireRelease(
  connect(),
  (conn) => conn.close()
))
```

### Compose Layers

```typescript
// Merge independent layers
const AppLayer = Layer.merge(DatabaseLive, CacheLive);

// Provide dependencies between layers
const FullLayer = DatabaseLive.pipe(Layer.provide(ConfigLive));
```

### Provide Layer to Program

```typescript
Effect.runPromise(program.pipe(Effect.provide(AppLayer)));
```
