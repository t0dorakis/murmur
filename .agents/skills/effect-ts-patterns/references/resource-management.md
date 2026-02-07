# Resource Management Patterns (8 patterns)

acquireRelease, Scope, Layer composition, pooling, timeouts.

## Table of Contents

- [Basic Patterns](#basic-patterns)
- [Layer-Based Resources](#layer-based-resources)
- [Advanced Patterns](#advanced-patterns)

---

## Basic Patterns

### acquireRelease - Guaranteed Cleanup

```typescript
import { Effect } from "effect";

const withConnection = Effect.acquireRelease(
  // Acquire
  Effect.tryPromise(() => database.connect()),
  // Release (always runs, even on error/interrupt)
  (connection) => Effect.sync(() => connection.close()),
);

// Use the resource
const program = Effect.scoped(
  withConnection.pipe(Effect.flatMap((conn) => conn.query("SELECT * FROM users"))),
);
```

### File Handle Example

```typescript
const withFile = (path: string) =>
  Effect.acquireRelease(
    Effect.sync(() => fs.openSync(path, "r")),
    (fd) => Effect.sync(() => fs.closeSync(fd)),
  );

const readFile = (path: string) =>
  Effect.scoped(
    withFile(path).pipe(Effect.flatMap((fd) => Effect.sync(() => fs.readFileSync(fd, "utf-8")))),
  );
```

### Multiple Resources

```typescript
const withResources = Effect.all([
  Effect.acquireRelease(openDb(), (db) => db.close()),
  Effect.acquireRelease(openCache(), (cache) => cache.close()),
  Effect.acquireRelease(openQueue(), (queue) => queue.close()),
]);

// Resources released in reverse order (queue, cache, db)
const program = Effect.scoped(
  withResources.pipe(Effect.flatMap(([db, cache, queue]) => doWork(db, cache, queue))),
);
```

---

## Layer-Based Resources

### Service Layer with Resource

```typescript
class Database extends Effect.Service<Database>()("Database", {
  scoped: Effect.gen(function* () {
    const config = yield* DatabaseConfig;

    const pool = yield* Effect.acquireRelease(
      Effect.tryPromise(() =>
        createPool({
          host: config.host,
          port: config.port,
          database: config.database,
        }),
      ),
      (pool) => Effect.promise(() => pool.end()),
    );

    return {
      query: <T>(sql: string, params?: unknown[]) =>
        Effect.tryPromise(() => pool.query(sql, params) as Promise<T>),

      transaction: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.acquireUseRelease(
          Effect.tryPromise(() => pool.connect()),
          (client) =>
            Effect.tryPromise(() => client.query("BEGIN")).pipe(
              Effect.andThen(effect),
              Effect.tap(() => Effect.tryPromise(() => client.query("COMMIT"))),
            ),
          (client) =>
            Effect.tryPromise(() => client.query("ROLLBACK")).pipe(
              Effect.ignore,
              Effect.andThen(Effect.sync(() => client.release())),
            ),
        ),
    };
  }),
}) {}
```

### Compose Resource Layers

```typescript
const DatabaseLive = Database.Default;
const CacheLive = Cache.Default;
const QueueLive = Queue.Default;

// Merge independent resources
const InfrastructureLive = Layer.merge(DatabaseLive, Layer.merge(CacheLive, QueueLive));

// Chain dependent resources
const AppLive = Layer.provide(UserServiceLive, InfrastructureLive);
```

### Managed Runtime

```typescript
// For applications with scoped layers
const program = Effect.gen(function* () {
  const db = yield* Database;
  return yield* db.query("SELECT 1");
});

// Launch keeps resources alive until interrupted
const main = Layer.launch(Layer.provide(Layer.effectDiscard(program), Database.Default));

Effect.runFork(main);
```

---

## Advanced Patterns

### Resource Pool

```typescript
const createPool = <A>(
  create: Effect.Effect<A>,
  destroy: (a: A) => Effect.Effect<void>,
  size: number,
) =>
  Effect.gen(function* () {
    const semaphore = yield* Effect.makeSemaphore(size);
    const pool = yield* Ref.make<A[]>([]);

    // Pre-populate pool
    const resources = yield* Effect.all(Array.from({ length: size }, () => create));
    yield* Ref.set(pool, resources);

    return {
      use: <B, E, R>(f: (a: A) => Effect.Effect<B, E, R>) =>
        semaphore.withPermits(1)(
          Effect.gen(function* () {
            const [resource, ...rest] = yield* Ref.get(pool);
            yield* Ref.set(pool, rest);

            const result = yield* f(resource).pipe(
              Effect.ensuring(Ref.update(pool, (p) => [...p, resource])),
            );

            return result;
          }),
        ),
    };
  });
```

### Resource Timeout

```typescript
const withTimeout = <A>(
  acquire: Effect.Effect<A>,
  release: (a: A) => Effect.Effect<void>,
  timeout: Duration.Duration,
) =>
  Effect.acquireRelease(
    acquire.pipe(
      Effect.timeout(timeout),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new TimeoutError()),
          onSome: Effect.succeed,
        }),
      ),
    ),
    release,
  );
```

### Hierarchical Resources

```typescript
// Parent resource that owns children
const createParent = Effect.gen(function* () {
  const scope = yield* Scope.make();

  const children = yield* Ref.make<Child[]>([]);

  const createChild = Effect.gen(function* () {
    const child = yield* Scope.extend(
      Effect.acquireRelease(
        Effect.sync(() => new Child()),
        (c) => c.close(),
      ),
      scope,
    );
    yield* Ref.update(children, (c) => [...c, child]);
    return child;
  });

  return {
    createChild,
    close: Scope.close(scope, Exit.void),
  };
});
```

### Manual Scope Management

```typescript
const manualScope = Effect.gen(function* () {
  const scope = yield* Scope.make();

  // Add finalizers manually
  yield* Scope.addFinalizer(scope, Effect.log("Cleanup 1"));
  yield* Scope.addFinalizer(scope, Effect.log("Cleanup 2"));

  // Use scope for acquire/release
  const resource = yield* Scope.extend(
    Effect.acquireRelease(
      Effect.sync(() => "resource"),
      () => Effect.log("Resource released"),
    ),
    scope,
  );

  // Do work
  yield* doWork(resource);

  // Close scope (runs all finalizers in reverse)
  yield* Scope.close(scope, Exit.succeed("done"));
});
```

### Resource-Safe Streaming

```typescript
const streamFromResource = <A, R>(
  acquire: Effect.Effect<R>,
  release: (r: R) => Effect.Effect<void>,
  produce: (r: R) => Effect.Effect<Option.Option<A>>,
) =>
  Stream.unwrapScoped(
    Effect.acquireRelease(acquire, release).pipe(
      Effect.map((resource) => Stream.repeatEffectOption(produce(resource))),
    ),
  );

// Example: Stream database rows
const streamRows = (query: string) =>
  streamFromResource(
    db.query(query), // Returns cursor
    (cursor) => cursor.close(),
    (cursor) =>
      Effect.sync(() => {
        const row = cursor.next();
        return row ? Option.some(row) : Option.none();
      }),
  );
```
