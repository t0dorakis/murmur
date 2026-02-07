# Testing Patterns (10 patterns)

Unit testing, service mocking, property-based testing, streams.

## Table of Contents

- [Basic Testing](#basic-testing)
- [Service Mocking](#service-mocking)
- [Testing Effects](#testing-effects)
- [Testing Streams](#testing-streams)
- [Property-Based Testing](#property-based-testing)

---

## Basic Testing

### Test Effect with runPromise

```typescript
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";

describe("UserService", () => {
  it("should create a user", async () => {
    const result = await Effect.runPromise(
      createUser({ name: "Alice", email: "alice@example.com" }),
    );

    expect(result.name).toBe("Alice");
    expect(result.id).toBeDefined();
  });
});
```

### Test with Provided Layers

```typescript
describe("UserService", () => {
  const TestLayer = Layer.mergeAll(MockDatabaseLive, MockEmailLive);

  it("should send welcome email on registration", async () => {
    const sentEmails: Email[] = [];

    const TestEmailService = Layer.succeed(EmailService, {
      send: (email) => Effect.sync(() => sentEmails.push(email)),
    });

    const result = await Effect.runPromise(
      registerUser({ name: "Bob", email: "bob@example.com" }).pipe(
        Effect.provide(Layer.merge(TestLayer, TestEmailService)),
      ),
    );

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe("bob@example.com");
  });
});
```

---

## Service Mocking

### Create Mock Layer

```typescript
// Real service interface
class UserRepository extends Effect.Service<UserRepository>()("UserRepository", {
  effect: Effect.gen(function* () {
    const db = yield* Database;
    return {
      findById: (id: string) => db.query("SELECT * FROM users WHERE id = ?", [id]),
      create: (user: User) => db.insert("users", user),
      delete: (id: string) => db.delete("users", { id }),
    };
  }),
}) {}

// Mock implementation for tests
const MockUserRepository = (users: Map<string, User> = new Map()) =>
  Layer.succeed(UserRepository, {
    findById: (id) => Effect.sync(() => Option.fromNullable(users.get(id))),
    create: (user) =>
      Effect.sync(() => {
        users.set(user.id, user);
        return user;
      }),
    delete: (id) =>
      Effect.sync(() => {
        users.delete(id);
      }),
  });
```

### Test with Mock

```typescript
describe("deleteUser", () => {
  it("should delete existing user", async () => {
    const users = new Map([["1", { id: "1", name: "Alice" }]]);

    const result = await Effect.runPromise(
      deleteUser("1").pipe(Effect.provide(MockUserRepository(users))),
    );

    expect(users.has("1")).toBe(false);
  });

  it("should fail for non-existent user", async () => {
    const result = await Effect.runPromiseExit(
      deleteUser("999").pipe(Effect.provide(MockUserRepository())),
    );

    expect(Exit.isFailure(result)).toBe(true);
  });
});
```

### Spy on Service Calls

```typescript
const createSpyService = () => {
  const calls: { method: string; args: unknown[] }[] = [];

  const service = Layer.succeed(UserRepository, {
    findById: (id) => {
      calls.push({ method: "findById", args: [id] });
      return Effect.succeed(Option.none());
    },
    create: (user) => {
      calls.push({ method: "create", args: [user] });
      return Effect.succeed(user);
    },
    delete: (id) => {
      calls.push({ method: "delete", args: [id] });
      return Effect.void;
    },
  });

  return { service, calls };
};

it("should call repository methods", async () => {
  const { service, calls } = createSpyService();

  await Effect.runPromise(createUser({ name: "Alice" }).pipe(Effect.provide(service)));

  expect(calls).toContainEqual({
    method: "create",
    args: [expect.objectContaining({ name: "Alice" })],
  });
});
```

---

## Testing Effects

### Test Success

```typescript
it("should succeed with value", async () => {
  const result = await Effect.runPromise(Effect.succeed(42));
  expect(result).toBe(42);
});
```

### Test Failure

```typescript
it("should fail with NotFoundError", async () => {
  const exit = await Effect.runPromiseExit(getUser("nonexistent").pipe(Effect.provide(TestLayer)));

  expect(Exit.isFailure(exit)).toBe(true);

  if (Exit.isFailure(exit)) {
    const error = Cause.failureOption(exit.cause);
    expect(Option.isSome(error)).toBe(true);
    expect(error.value._tag).toBe("NotFound");
  }
});
```

### Test Effect Type Directly

```typescript
import { Exit, Cause } from "effect";

it("should handle typed errors", async () => {
  const effect: Effect.Effect<User, NotFoundError | ValidationError> = getUser("invalid");

  const exit = await Effect.runPromiseExit(effect.pipe(Effect.provide(TestLayer)));

  Exit.match(exit, {
    onFailure: (cause) => {
      const failures = Cause.failures(cause);
      expect(Chunk.toArray(failures)).toEqual([expect.objectContaining({ _tag: "NotFound" })]);
    },
    onSuccess: () => {
      throw new Error("Should have failed");
    },
  });
});
```

### Test with TestClock

```typescript
import { TestClock, TestContext } from "effect";

it("should timeout after 5 seconds", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(slowOperation().pipe(Effect.timeout("5 seconds")));

      // Fast-forward time
      yield* TestClock.adjust("6 seconds");

      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );

  expect(Option.isNone(result)).toBe(true);
});
```

---

## Testing Streams

### Collect Stream Results

```typescript
it("should produce expected elements", async () => {
  const stream = Stream.fromIterable([1, 2, 3]).pipe(Stream.map((n) => n * 2));

  const result = await Effect.runPromise(stream.pipe(Stream.runCollect));

  expect(Chunk.toArray(result)).toEqual([2, 4, 6]);
});
```

### Test Stream Errors

```typescript
it("should handle stream errors", async () => {
  const stream = Stream.fromIterable([1, 2, 3]).pipe(
    Stream.mapEffect((n) => (n === 2 ? Effect.fail(new ProcessingError()) : Effect.succeed(n))),
  );

  const exit = await Effect.runPromiseExit(stream.pipe(Stream.runCollect));

  expect(Exit.isFailure(exit)).toBe(true);
});
```

### Test Stream with Take

```typescript
it("should take first N elements", async () => {
  const infiniteStream = Stream.iterate(1, (n) => n + 1);

  const result = await Effect.runPromise(infiniteStream.pipe(Stream.take(5), Stream.runCollect));

  expect(Chunk.toArray(result)).toEqual([1, 2, 3, 4, 5]);
});
```

---

## Property-Based Testing

### With fast-check

```typescript
import * as fc from "fast-check";
import { it } from "bun:test";

it("should parse and encode symmetrically", () => {
  fc.assert(
    fc.property(
      fc.record({
        id: fc.uuid(),
        name: fc.string({ minLength: 1 }),
        age: fc.integer({ min: 0, max: 150 }),
      }),
      async (user) => {
        const encoded = await Effect.runPromise(Schema.encode(User)(user));

        const decoded = await Effect.runPromise(Schema.decodeUnknown(User)(encoded));

        expect(decoded).toEqual(user);
      },
    ),
  );
});
```

### Test Commutativity

```typescript
it("Effect.all should be order-independent for success", () => {
  fc.assert(
    fc.asyncProperty(fc.array(fc.integer()), async (numbers) => {
      const effects = numbers.map((n) => Effect.succeed(n));

      const forward = await Effect.runPromise(Effect.all(effects));
      const reverse = await Effect.runPromise(Effect.all([...effects].reverse()));

      expect(forward).toEqual(numbers);
      expect(reverse).toEqual([...numbers].reverse());
    }),
  );
});
```

### Test Schema Validation

```typescript
it("should reject invalid emails", () => {
  const Email = Schema.String.pipe(Schema.pattern(/@/));

  fc.assert(
    fc.property(
      fc.string().filter((s) => !s.includes("@")),
      async (invalidEmail) => {
        const exit = await Effect.runPromiseExit(Schema.decodeUnknown(Email)(invalidEmail));

        expect(Exit.isFailure(exit)).toBe(true);
      },
    ),
  );
});
```

### Test Error Recovery

```typescript
it("catchAll should recover from any failure", () => {
  fc.assert(
    fc.asyncProperty(fc.string(), async (errorMsg) => {
      const failing = Effect.fail(new Error(errorMsg));
      const fallback = 42;

      const result = await Effect.runPromise(
        failing.pipe(Effect.catchAll(() => Effect.succeed(fallback))),
      );

      expect(result).toBe(fallback);
    }),
  );
});
```
