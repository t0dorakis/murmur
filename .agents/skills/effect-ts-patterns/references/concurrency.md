# Concurrency Patterns (24 patterns)

Fibers, parallel execution, coordination primitives, and state management.

## Table of Contents

- [Parallel Execution](#parallel-execution)
- [Fibers](#fibers)
- [Coordination Primitives](#coordination-primitives)
- [State Management](#state-management)
- [Advanced Patterns](#advanced-patterns)

---

## Parallel Execution

### Effect.all - Run Multiple Effects

```typescript
// Sequential (default)
const results = yield * Effect.all([effectA, effectB, effectC]);

// Parallel
const results =
  yield *
  Effect.all([effectA, effectB, effectC], {
    concurrency: "unbounded",
  });

// Limited concurrency
const results =
  yield *
  Effect.all([effectA, effectB, effectC], {
    concurrency: 5,
  });
```

### Effect.forEach - Process Collection

```typescript
// Process items with concurrency limit
const results = yield * Effect.forEach(userIds, (id) => fetchUser(id), { concurrency: 10 });
```

### Effect.race - First to Complete

```typescript
// Returns result of first effect to succeed
const fastest = yield * Effect.race(effectA, effectB);
```

### Effect.raceAll - Race Multiple

```typescript
const fastest = yield * Effect.raceAll([fetchFromPrimary(), fetchFromBackup(), fetchFromCache()]);
```

### Effect.timeout - Add Deadline

```typescript
const result = yield * slowOperation().pipe(Effect.timeout("5 seconds"));
// Returns Option<A> - None if timed out
```

---

## Fibers

### Understanding Fibers

A Fiber is a lightweight virtual thread managed by the Effect runtime. Unlike OS threads:

- Extremely cheap to create (thousands possible)
- Cooperative scheduling (explicit yield points)
- Automatic interruption propagation

### Effect.fork - Run in Background

```typescript
const program = Effect.gen(function* () {
  const fiber = yield* longRunningTask().pipe(Effect.fork);

  // Continue immediately, task runs in background
  yield* doOtherWork();

  // Wait for background task when needed
  const result = yield* Fiber.join(fiber);
});
```

### Fiber.interrupt - Cancel Fiber

```typescript
const program = Effect.gen(function* () {
  const fiber = yield* backgroundTask().pipe(Effect.fork);

  yield* Effect.sleep("5 seconds");

  // Cancel the background task
  yield* Fiber.interrupt(fiber);
});
```

### Effect.forkDaemon - Detached Fiber

```typescript
// Fiber continues even if parent is interrupted
const daemon = yield * backgroundJob().pipe(Effect.forkDaemon);
```

### Effect.runFork - Application Entry

```typescript
// For long-running applications
const fiber = Effect.runFork(mainProgram);

// Graceful shutdown
process.on("SIGINT", () => {
  Effect.runPromise(Fiber.interrupt(fiber));
});
```

---

## Coordination Primitives

### Deferred - One-Time Signal

A Deferred is completed exactly once, and many fibers can wait for it:

```typescript
const program = Effect.gen(function* () {
  const signal = yield* Deferred.make<void>();

  // Worker waits for signal
  const worker = yield* Effect.fork(
    Effect.gen(function* () {
      yield* Deferred.await(signal);
      yield* Effect.log("Signal received, starting work");
    }),
  );

  // Do initialization
  yield* initializeServices();

  // Signal workers to start
  yield* Deferred.succeed(signal, undefined);

  yield* Fiber.join(worker);
});
```

**Use cases**: Service initialization gates, producer-consumer coordination.

### Semaphore - Rate Limiting

Control concurrent access to a resource:

```typescript
const program = Effect.gen(function* () {
  const semaphore = yield* Effect.makeSemaphore(3); // Max 3 concurrent

  yield* Effect.forEach(urls, (url) => semaphore.withPermits(1)(fetchUrl(url)), {
    concurrency: "unbounded",
  });
});
```

**Use cases**: Connection pooling, API rate limiting, resource protection.

### Latch - Barrier Synchronization

Coordinate N fibers to reach a point before continuing:

```typescript
const program = Effect.gen(function* () {
  const latch = yield* Effect.makeLatch();

  // Start workers that wait at latch
  const workers = yield* Effect.all(
    [1, 2, 3].map((id) =>
      Effect.fork(
        Effect.gen(function* () {
          yield* prepareWork(id);
          yield* latch.await(); // Wait for all to be ready
          yield* doWork(id);
        }),
      ),
    ),
  );

  // Release all workers when ready
  yield* latch.open();
});
```

### Queue - Work Distribution

Point-to-point messaging between fibers:

```typescript
const program = Effect.gen(function* () {
  const queue = yield* Queue.bounded<Task>(100);

  // Producer
  const producer = yield* Effect.fork(Effect.forEach(tasks, (task) => Queue.offer(queue, task)));

  // Consumer
  const consumer = yield* Effect.fork(
    Effect.forever(
      Effect.gen(function* () {
        const task = yield* Queue.take(queue);
        yield* processTask(task);
      }),
    ),
  );
});
```

**Queue types**:

- `Queue.bounded(n)` - Blocks when full
- `Queue.unbounded()` - Unlimited capacity
- `Queue.dropping(n)` - Drops new items when full
- `Queue.sliding(n)` - Drops oldest items when full

### PubSub - Broadcast Messaging

One-to-many event distribution:

```typescript
const program = Effect.gen(function* () {
  const pubsub = yield* PubSub.bounded<Event>(100);

  // Subscribe creates a Queue for this subscriber
  const subscription1 = yield* PubSub.subscribe(pubsub);
  const subscription2 = yield* PubSub.subscribe(pubsub);

  // Publish - all subscribers receive
  yield* PubSub.publish(pubsub, { type: "user-login", userId: "123" });

  // Each subscriber gets the event
  const event1 = yield* Queue.take(subscription1);
  const event2 = yield* Queue.take(subscription2);
});
```

---

## State Management

### Ref - Atomic Mutable State

```typescript
const program = Effect.gen(function* () {
  const counter = yield* Ref.make(0);

  // Read
  const value = yield* Ref.get(counter);

  // Write
  yield* Ref.set(counter, 10);

  // Update atomically
  yield* Ref.update(counter, (n) => n + 1);

  // Update and return old value
  const old = yield* Ref.getAndUpdate(counter, (n) => n * 2);

  // Modify with result
  const result = yield* Ref.modify(counter, (n) => [n > 10, n + 1]);
});
```

### SynchronizedRef - Effectful Updates

When updates need to run effects:

```typescript
const program = Effect.gen(function* () {
  const cache = yield* SynchronizedRef.make<Map<string, User>>(new Map());

  // Effectful update with locking
  yield* SynchronizedRef.updateEffect(cache, (map) =>
    Effect.gen(function* () {
      const user = yield* fetchUser(userId);
      return new Map(map).set(userId, user);
    }),
  );
});
```

### SubscriptionRef - Observable State

State that notifies subscribers on change:

```typescript
const program = Effect.gen(function* () {
  const state = yield* SubscriptionRef.make({ count: 0, status: "idle" });

  // Subscribe to changes
  const subscription = yield* SubscriptionRef.changes(state);

  // React to state changes
  yield* Effect.fork(
    Stream.runForEach(subscription, (newState) =>
      Effect.log(`State changed: ${JSON.stringify(newState)}`),
    ),
  );

  // Update state (notifies subscribers)
  yield* SubscriptionRef.update(state, (s) => ({ ...s, count: s.count + 1 }));
});
```

---

## Advanced Patterns

### Graceful Shutdown

```typescript
const main = Effect.gen(function* () {
  const shutdownSignal = yield* Deferred.make<void>();

  // Setup signal handlers
  process.on("SIGINT", () => {
    Effect.runPromise(Deferred.succeed(shutdownSignal, undefined));
  });

  // Run services until shutdown
  yield* Effect.race(runServices(), Deferred.await(shutdownSignal));

  yield* Effect.log("Graceful shutdown complete");
});

Effect.runFork(main);
```

### Polling with Race

```typescript
const pollUntilComplete = (taskId: string) =>
  Effect.gen(function* () {
    const task = yield* startTask(taskId);

    const poller = Effect.gen(function* () {
      yield* Effect.forever(
        Effect.gen(function* () {
          const status = yield* checkStatus(taskId);
          yield* Effect.log(`Status: ${status}`);
          yield* Effect.sleep("1 second");
        }),
      );
    });

    // Race: task completion vs polling
    yield* Effect.race(Fiber.join(task), poller);
  });
```

### Caching Layer Pattern

```typescript
class CachedUserService extends Effect.Service<CachedUserService>()("CachedUserService", {
  effect: Effect.gen(function* () {
    const users = yield* UserService;
    const cache = yield* Ref.make(new Map<string, User>());

    return {
      findById: (id: string) =>
        Effect.gen(function* () {
          const cached = yield* Ref.get(cache);
          if (cached.has(id)) return cached.get(id)!;

          const user = yield* users.findById(id);
          yield* Ref.update(cache, (m) => new Map(m).set(id, user));
          return user;
        }),
    };
  }),
}) {}
```
