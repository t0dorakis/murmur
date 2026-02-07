# Scheduling Patterns (6 patterns)

Control timing, repetition, and resilience with Effect's Schedule module.

## Table of Contents

- [Fixed Intervals](#fixed-intervals)
- [Cron Expressions](#cron-expressions)
- [Debounce and Throttle](#debounce-and-throttle)
- [Retry Chains and Exponential Backoff](#retry-chains-and-exponential-backoff)
- [Circuit Breakers](#circuit-breakers)
- [Schedule Combinators](#schedule-combinators)

---

## Fixed Intervals

### Schedule.fixed - Consistent Intervals

```typescript
import { Effect, Schedule } from "effect";

// Run every 5 seconds
const poll = Effect.gen(function* () {
  const status = yield* checkServiceHealth();
  yield* Effect.log(`Health: ${status}`);
}).pipe(Effect.repeat(Schedule.fixed("5 seconds")));

// Run with initial delay
const delayedPoll = Effect.gen(function* () {
  yield* Effect.sleep("2 seconds"); // Initial delay
  yield* Effect.log("Starting...");
}).pipe(Effect.repeat(Schedule.fixed("10 seconds")));
```

### Schedule.spaced - Fixed Delay After Completion

```typescript
// Wait 5 seconds AFTER each execution completes
const spacedPoll = checkStatus().pipe(Effect.repeat(Schedule.spaced("5 seconds")));
// Unlike fixed(), accounts for execution time
```

### Schedule.forever - Infinite Repetition

```typescript
const daemon = processQueue().pipe(Effect.repeat(Schedule.forever));
```

---

## Cron Expressions

### Schedule.cron - Cron-Style Scheduling

```typescript
// Run at midnight every day
const midnightJob = cleanup().pipe(Effect.repeat(Schedule.cron("0 0 * * *")));

// Run every Monday at 9 AM
const weeklyReport = generateReport().pipe(Effect.repeat(Schedule.cron("0 9 * * 1")));

// Run every 15 minutes
const frequentCheck = syncData().pipe(Effect.repeat(Schedule.cron("*/15 * * * *")));
```

### Cron Expression Reference

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, 0=Sunday)
│ │ │ │ │
* * * * *
```

### Schedule.dayOfWeek / hourOfDay

```typescript
// Run on weekdays at specific hours
const businessHours = task().pipe(
  Effect.repeat(Schedule.hourOfDay(9).pipe(Schedule.intersect(Schedule.dayOfWeek(1, 2, 3, 4, 5)))),
);
```

---

## Debounce and Throttle

### Debounce - Wait for Quiet Period

```typescript
import { Effect, Queue, Fiber, Ref } from "effect";

const makeDebouncer = <A>(delay: Duration.DurationInput) =>
  Effect.gen(function* () {
    const pending = yield* Ref.make<Fiber.Fiber<void> | null>(null);

    return (effect: Effect.Effect<A>) =>
      Effect.gen(function* () {
        // Cancel any pending execution
        const current = yield* Ref.get(pending);
        if (current) yield* Fiber.interrupt(current);

        // Schedule new execution after delay
        const fiber = yield* Effect.sleep(delay).pipe(Effect.andThen(effect), Effect.fork);
        yield* Ref.set(pending, fiber);
      });
  });

// Usage: only process after 300ms of no new input
const debounced = Effect.gen(function* () {
  const debounce = yield* makeDebouncer("300 millis");
  yield* debounce(saveToDatabase(data));
});
```

### Throttle - Rate Limit Execution

```typescript
const makeThrottler = (interval: Duration.DurationInput) =>
  Effect.gen(function* () {
    const lastRun = yield* Ref.make(0);

    return <A>(effect: Effect.Effect<A>) =>
      Effect.gen(function* () {
        const now = Date.now();
        const last = yield* Ref.get(lastRun);
        const elapsed = now - last;

        if (elapsed >= Duration.toMillis(Duration.decode(interval))) {
          yield* Ref.set(lastRun, now);
          return yield* effect;
        }
        return yield* Effect.void;
      });
  });

// Usage: max once per second
const throttled = Effect.gen(function* () {
  const throttle = yield* makeThrottler("1 second");
  yield* throttle(sendAnalytics(event));
});
```

---

## Retry Chains and Exponential Backoff

### Basic Exponential Backoff

```typescript
// Retry with doubling delays: 1s, 2s, 4s, 8s, 16s
const resilientFetch = fetchData().pipe(
  Effect.retry(Schedule.exponential("1 second").pipe(Schedule.compose(Schedule.recurs(5)))),
);
```

### Exponential with Jitter

```typescript
// Add randomness to prevent thundering herd
const jitteredRetry = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.compose(Schedule.recurs(5)),
);

const program = apiCall().pipe(Effect.retry(jitteredRetry));
```

### Capped Exponential Backoff

```typescript
// Exponential but never exceed 30 seconds
const cappedBackoff = Schedule.exponential("1 second").pipe(
  Schedule.either(Schedule.spaced("30 seconds")),
  Schedule.compose(Schedule.recurs(10)),
);
```

### Retry Chain with Fallback

```typescript
// Fast retries first, then slower, then give up
const retryChain = Schedule.recurs(3).pipe(
  Schedule.addDelay(() => "100 millis"),
  Schedule.andThen(Schedule.recurs(3).pipe(Schedule.addDelay(() => "1 second"))),
  Schedule.andThen(Schedule.recurs(2).pipe(Schedule.addDelay(() => "5 seconds"))),
);
```

### Conditional Retry

```typescript
// Only retry transient errors
const selectiveRetry = fetchData().pipe(
  Effect.retry({
    schedule: Schedule.exponential("1 second").pipe(Schedule.recurs(5)),
    while: (error) => error._tag === "NetworkError" || error._tag === "TimeoutError",
  }),
);
```

---

## Circuit Breakers

### Basic Circuit Breaker

```typescript
import { Effect, Ref, Data } from "effect";

class CircuitOpenError extends Data.TaggedError("CircuitOpen")<{
  readonly resetAt: number;
}> {}

interface CircuitBreaker {
  readonly call: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E | CircuitOpenError>;
}

const makeCircuitBreaker = (
  maxFailures: number,
  resetTimeout: Duration.DurationInput,
): Effect.Effect<CircuitBreaker> =>
  Effect.gen(function* () {
    const failures = yield* Ref.make(0);
    const openUntil = yield* Ref.make(0);

    return {
      call: <A, E>(effect: Effect.Effect<A, E>) =>
        Effect.gen(function* () {
          const now = Date.now();
          const resetAt = yield* Ref.get(openUntil);

          // Check if circuit is open
          if (now < resetAt) {
            return yield* Effect.fail(new CircuitOpenError({ resetAt }));
          }

          // Try the effect
          const result = yield* effect.pipe(
            Effect.tap(() => Ref.set(failures, 0)),
            Effect.tapError(() =>
              Effect.gen(function* () {
                const count = yield* Ref.updateAndGet(failures, (n) => n + 1);
                if (count >= maxFailures) {
                  yield* Ref.set(openUntil, now + Duration.toMillis(Duration.decode(resetTimeout)));
                }
              }),
            ),
          );
          return result;
        }),
    };
  });

// Usage
const program = Effect.gen(function* () {
  const breaker = yield* makeCircuitBreaker(5, "30 seconds");

  yield* breaker
    .call(externalApiCall())
    .pipe(
      Effect.catchTag("CircuitOpen", (e) =>
        Effect.log(`Circuit open until ${new Date(e.resetAt).toISOString()}`),
      ),
    );
});
```

### Circuit Breaker with Half-Open State

```typescript
type CircuitState = "closed" | "open" | "half-open";

const makeAdvancedCircuitBreaker = (config: {
  maxFailures: number;
  resetTimeout: Duration.DurationInput;
  halfOpenRequests: number;
}) =>
  Effect.gen(function* () {
    const state = yield* Ref.make<CircuitState>("closed");
    const failures = yield* Ref.make(0);
    const openUntil = yield* Ref.make(0);
    const halfOpenAttempts = yield* Ref.make(0);

    return {
      call: <A, E>(effect: Effect.Effect<A, E>) =>
        Effect.gen(function* () {
          const currentState = yield* Ref.get(state);
          const now = Date.now();

          if (currentState === "open") {
            const resetAt = yield* Ref.get(openUntil);
            if (now >= resetAt) {
              yield* Ref.set(state, "half-open");
              yield* Ref.set(halfOpenAttempts, 0);
            } else {
              return yield* Effect.fail(new CircuitOpenError({ resetAt }));
            }
          }

          return yield* effect.pipe(
            Effect.tap(() =>
              Effect.gen(function* () {
                const s = yield* Ref.get(state);
                if (s === "half-open") {
                  const attempts = yield* Ref.updateAndGet(halfOpenAttempts, (n) => n + 1);
                  if (attempts >= config.halfOpenRequests) {
                    yield* Ref.set(state, "closed");
                    yield* Ref.set(failures, 0);
                  }
                }
              }),
            ),
            Effect.tapError(() =>
              Effect.gen(function* () {
                yield* Ref.set(state, "open");
                yield* Ref.set(
                  openUntil,
                  now + Duration.toMillis(Duration.decode(config.resetTimeout)),
                );
              }),
            ),
          );
        }),
    };
  });
```

---

## Schedule Combinators

### Combining Schedules

```typescript
// Union: run until EITHER schedule is done
const unionSchedule = Schedule.recurs(3).pipe(Schedule.union(Schedule.spaced("1 second")));

// Intersect: run until BOTH conditions are met
const intersectSchedule = Schedule.recurs(10).pipe(
  Schedule.intersect(
    Schedule.elapsed.pipe(Schedule.whileOutput((elapsed) => elapsed < Duration.seconds(30))),
  ),
);

// AndThen: run first schedule, then second
const chainedSchedule = Schedule.recurs(3).pipe(
  Schedule.andThen(Schedule.spaced("5 seconds").pipe(Schedule.recurs(2))),
);
```

### Schedule Modifiers

```typescript
// Add delay to any schedule
const delayed = Schedule.recurs(5).pipe(Schedule.addDelay(() => "500 millis"));

// Run while condition holds
const conditional = Schedule.forever.pipe(Schedule.whileInput<number>((n) => n < 100));

// Collect outputs
const collecting = Schedule.recurs(5).pipe(Schedule.collectAllOutputs);
```
