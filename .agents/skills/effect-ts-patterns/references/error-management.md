# Error Management Patterns (19 patterns)

Handle errors with typed errors, recovery strategies, retries, and structured logging.

## Table of Contents

- [Defining Errors](#defining-errors)
- [Catching Errors](#catching-errors)
- [Pattern Matching](#pattern-matching)
- [Retries & Timeouts](#retries--timeouts)
- [Logging](#logging)
- [Advanced Error Handling](#advanced-error-handling)

---

## Defining Errors

### Tagged Errors with Data.TaggedError

Create type-safe, discriminated errors:

```typescript
import { Data, Effect } from "effect";

class NotFoundError extends Data.TaggedError("NotFound")<{
  readonly resourceType: string;
  readonly id: string;
}> {}

class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
  readonly message: string;
}> {}

class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly url: string;
  readonly code: number;
}> {}

// Usage
const fetchUser = (id: string): Effect.Effect<User, NotFoundError | NetworkError> =>
  Effect.gen(function* () {
    if (!id) return yield* Effect.fail(new NotFoundError({ resourceType: "User", id }));
    // ...
  });
```

**Anti-pattern**: Using plain `Error` objects - loses type information.

---

## Catching Errors

### catchTag - Handle Specific Error

```typescript
const program = fetchUser(id).pipe(
  Effect.catchTag("NotFound", (e) => Effect.succeed({ id: e.id, name: "Guest" })),
);
// Error type: NetworkError (NotFound is handled)
```

### catchTags - Handle Multiple Specific Errors

```typescript
const program = fetchUser(id).pipe(
  Effect.catchTags({
    NotFound: (e) => Effect.succeed(createGuestUser()),
    NetworkError: (e) => Effect.retry(fetchUser(id), Schedule.exponential("1 second")),
  }),
);
// Error type: never (all errors handled)
```

### catchAll - Handle Any Error

```typescript
const program = fetchUser(id).pipe(
  Effect.catchAll((error) => {
    console.error("Failed:", error);
    return Effect.succeed(defaultUser);
  }),
);
```

### catchSome - Handle Conditionally

```typescript
const program = fetchUser(id).pipe(
  Effect.catchSome((error) => {
    if (error._tag === "NotFound") {
      return Option.some(Effect.succeed(defaultUser));
    }
    return Option.none(); // Don't handle, let it propagate
  }),
);
```

---

## Pattern Matching

### match - Handle Success and Failure

```typescript
const result =
  yield *
  someEffect.pipe(
    Effect.match({
      onFailure: (error) => `Error: ${error._tag}`,
      onSuccess: (value) => `Success: ${value}`,
    }),
  );
```

### matchEffect - Effectful Branches

```typescript
const result =
  yield *
  someEffect.pipe(
    Effect.matchEffect({
      onFailure: (error) => logAndReturnDefault(error),
      onSuccess: (value) => processAndReturn(value),
    }),
  );
```

### matchTag/matchTags - Pattern Match Tagged Errors

```typescript
// Single tag
const message =
  yield *
  Either.match(result, {
    onLeft: (e) =>
      Effect.matchTag(e, {
        NotFound: (err) => `Not found: ${err.id}`,
        NetworkError: (err) => `Network error: ${err.code}`,
      }),
    onRight: (v) => `Success: ${v}`,
  });
```

### Option/Either Pattern Matching

```typescript
// Option
Option.match(maybeUser, {
  onNone: () => "No user",
  onSome: (user) => user.name,
});

// Either
Either.match(result, {
  onLeft: (error) => `Failed: ${error}`,
  onRight: (value) => `Got: ${value}`,
});
```

---

## Retries & Timeouts

### Basic Retry

```typescript
const program = fetchData().pipe(Effect.retry(Schedule.recurs(3)));
```

### Exponential Backoff

```typescript
const program = fetchData().pipe(
  Effect.retry(Schedule.exponential("1 second").pipe(Schedule.compose(Schedule.recurs(5)))),
);
```

### Retry with Jitter

```typescript
const schedule = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.compose(Schedule.recurs(5)),
);
```

### Retry Specific Errors

```typescript
const program = fetchData().pipe(
  Effect.retry({
    schedule: Schedule.recurs(3),
    while: (error) => error._tag === "NetworkError",
  }),
);
```

### Timeout

```typescript
const program = slowOperation().pipe(Effect.timeout("5 seconds"));
// Returns Option<A> - None if timed out
```

### Timeout with Failure

```typescript
const program = slowOperation().pipe(
  Effect.timeoutFail({
    duration: "5 seconds",
    onTimeout: () => new TimeoutError(),
  }),
);
```

### Combined Retry + Timeout

```typescript
const resilientFetch = fetchData().pipe(
  Effect.timeout("10 seconds"),
  Effect.retry(Schedule.exponential("1 second").pipe(Schedule.recurs(3))),
  Effect.catchTag("TimeoutException", () => Effect.fail(new TimeoutError())),
);
```

---

## Logging

### Built-in Log Functions

```typescript
yield * Effect.log("Info message");
yield * Effect.logDebug("Debug details");
yield * Effect.logInfo("Informational");
yield * Effect.logWarning("Warning!");
yield * Effect.logError("Error occurred");
yield * Effect.logFatal("Critical failure");
```

### Structured Logging with Annotations

```typescript
const program = Effect.gen(function* () {
  yield* Effect.log("Processing request");
}).pipe(Effect.annotateLogs("userId", userId), Effect.annotateLogs("requestId", requestId));
```

### Log Spans for Timing

```typescript
const program = Effect.gen(function* () {
  yield* Effect.logSpan("database-query")(databaseQuery());
});
```

---

## Advanced Error Handling

### Map Errors to Domain Types

```typescript
const program = lowLevelOperation().pipe(Effect.mapError((e) => new DomainError({ cause: e })));
```

### Cause - Inspect Full Error Details

```typescript
const program = riskyOperation().pipe(
  Effect.catchAllCause((cause) => {
    if (Cause.isDie(cause)) {
      // Unexpected defect (thrown exception)
      return Effect.logFatal("Defect", Cause.pretty(cause));
    }
    if (Cause.isInterrupted(cause)) {
      // Fiber was interrupted
      return Effect.log("Interrupted");
    }
    // Expected failure
    return Effect.log("Failed", Cause.failures(cause));
  }),
);
```

### orElse - Fallback Effect

```typescript
const program = primaryOperation().pipe(Effect.orElse(() => fallbackOperation()));
```

### orDie - Convert to Defect

```typescript
// Turn failures into defects (untyped throws)
const program = operation().pipe(Effect.orDie);
```

### Conditionally Branch on Runtime Values

```typescript
const program = Effect.gen(function* () {
  const value = yield* getValue();

  if (value < 0) {
    return yield* Effect.fail(new NegativeValueError({ value }));
  }

  return yield* processPositive(value);
});

// Or with filterOrFail
const program = getValue().pipe(
  Effect.filterOrFail(
    (v) => v >= 0,
    (v) => new NegativeValueError({ value: v }),
  ),
);
```
