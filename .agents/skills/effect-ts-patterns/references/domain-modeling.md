# Domain Modeling Patterns (15 patterns)

Branded types, tagged errors, Option for missing values, Schema contracts.

## Table of Contents

- [Tagged Errors](#tagged-errors)
- [Branded Types](#branded-types)
- [Option for Missing Values](#option-for-missing-values)
- [Schema-First Design](#schema-first-design)
- [Service Patterns](#service-patterns)

---

## Tagged Errors

### Define Domain Errors

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

class UnauthorizedError extends Data.TaggedError("Unauthorized")<{
  readonly reason: string;
}> {}

class ConflictError extends Data.TaggedError("Conflict")<{
  readonly message: string;
}> {}
```

### Use in Functions

```typescript
const getUser = (id: string): Effect.Effect<User, NotFoundError | UnauthorizedError> =>
  Effect.gen(function* () {
    const session = yield* getSession();
    if (!session) {
      return yield* Effect.fail(new UnauthorizedError({ reason: "No session" }));
    }

    const user = yield* findUser(id);
    if (!user) {
      return yield* Effect.fail(new NotFoundError({ resourceType: "User", id }));
    }

    return user;
  });
```

### Handle with catchTags

```typescript
const result =
  yield *
  getUser(id).pipe(
    Effect.catchTags({
      NotFound: (e) => Effect.succeed({ id: e.id, name: "Guest" }),
      Unauthorized: () => Effect.fail(new RedirectError({ to: "/login" })),
    }),
  );
```

---

## Branded Types

### Create Type-Safe IDs

```typescript
import { Brand } from "effect";

type UserId = string & Brand.Brand<"UserId">;
const UserId = Brand.nominal<UserId>();

type OrderId = string & Brand.Brand<"OrderId">;
const OrderId = Brand.nominal<OrderId>();

// Usage - compiler prevents mixing
const userId: UserId = UserId("user_123");
const orderId: OrderId = OrderId("order_456");

// ERROR: Type 'UserId' is not assignable to type 'OrderId'
// getOrder(userId)
```

### Validated Branded Types

```typescript
type Email = string & Brand.Brand<"Email">;
const Email = Brand.refined<Email>(
  (s) => /^[^@]+@[^@]+\.[^@]+$/.test(s),
  (s) => Brand.error(`Invalid email: ${s}`),
);

// Throws on invalid input
const email = Email("user@example.com");

// Safe parsing
const maybeEmail = Brand.is(Email)("test@example.com")
  ? Option.some(Email("test@example.com"))
  : Option.none();
```

### With Schema

```typescript
const Email = Schema.String.pipe(Schema.pattern(/^[^@]+@[^@]+\.[^@]+$/), Schema.brand("Email"));

const UserId = Schema.String.pipe(Schema.startsWith("user_"), Schema.brand("UserId"));

const PositiveInt = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.brand("PositiveInt"),
);
```

---

## Option for Missing Values

### Model Absence Explicitly

```typescript
import { Option } from "effect";

interface UserRepository {
  findById(id: UserId): Effect.Effect<Option.Option<User>>;
  findByEmail(email: Email): Effect.Effect<Option.Option<User>>;
}
```

### Distinguish Not Found from Error

```typescript
// Return Option for "not found"
const findUser = (id: string): Effect.Effect<Option.Option<User>, DatabaseError> =>
  Effect.gen(function* () {
    const result = yield* db.query("SELECT * FROM users WHERE id = ?", [id]);
    return Option.fromNullable(result[0]);
  });

// Usage
const getOrCreate = (id: string) =>
  Effect.gen(function* () {
    const existing = yield* findUser(id);

    return Option.match(existing, {
      onNone: () => createUser(id),
      onSome: (user) => Effect.succeed(user),
    });
  });
```

### Common Option Operations

```typescript
// Create
Option.some(42);
Option.none();
Option.fromNullable(maybeNull);

// Transform
Option.map(opt, (n) => n * 2);
Option.flatMap(opt, (n) => (n > 0 ? Option.some(n) : Option.none()));

// Extract
Option.getOrElse(opt, () => 0);
Option.getOrThrow(opt); // Throws if None

// Pattern match
Option.match(opt, {
  onNone: () => "missing",
  onSome: (v) => `found: ${v}`,
});
```

---

## Schema-First Design

### Define Contracts First

```typescript
// 1. Define the schema
const CreateUserRequest = Schema.Struct({
  email: Schema.String.pipe(Schema.pattern(/@/), Schema.brand("Email")),
  name: Schema.String.pipe(Schema.minLength(1)),
  role: Schema.Literal("admin", "user", "guest"),
});

const User = Schema.Struct({
  id: Schema.String.pipe(Schema.brand("UserId")),
  email: Schema.String.pipe(Schema.brand("Email")),
  name: Schema.String,
  role: Schema.Literal("admin", "user", "guest"),
  createdAt: Schema.Date,
});

// 2. Derive types
type CreateUserRequest = Schema.Schema.Type<typeof CreateUserRequest>;
type User = Schema.Schema.Type<typeof User>;

// 3. Implement service using types
const createUser = (request: CreateUserRequest): Effect.Effect<User, ValidationError> =>
  Effect.gen(function* () {
    // Types are enforced
    const user: User = {
      id: UserId(crypto.randomUUID()),
      email: request.email,
      name: request.name,
      role: request.role,
      createdAt: new Date(),
    };
    return user;
  });
```

### Validate at Boundaries

```typescript
const handleCreateUser = (rawData: unknown) =>
  Effect.gen(function* () {
    // Validate incoming data
    const request = yield* Schema.decodeUnknown(CreateUserRequest)(rawData).pipe(
      Effect.mapError(
        (e) =>
          new ValidationError({
            field: "request",
            message: TreeFormatter.formatError(e),
          }),
      ),
    );

    // Business logic with validated types
    const user = yield* createUser(request);

    // Validate outgoing data (optional)
    return yield* Schema.encode(User)(user);
  });
```

---

## Service Patterns

### Define Service Interface

```typescript
class UserService extends Effect.Service<UserService>()("UserService", {
  effect: Effect.gen(function* () {
    const db = yield* Database;

    return {
      findById: (id: UserId): Effect.Effect<Option.Option<User>, DatabaseError> =>
        Effect.gen(function* () {
          const result = yield* db.query("SELECT * FROM users WHERE id = ?", [id]);
          return Option.fromNullable(result[0]);
        }),

      create: (request: CreateUserRequest): Effect.Effect<User, ValidationError | DatabaseError> =>
        Effect.gen(function* () {
          const user: User = {
            id: UserId(crypto.randomUUID()),
            ...request,
            createdAt: new Date(),
          };
          yield* db.insert("users", user);
          return user;
        }),

      delete: (id: UserId): Effect.Effect<void, NotFoundError | DatabaseError> =>
        Effect.gen(function* () {
          const rows = yield* db.delete("users", { id });
          if (rows === 0) {
            return yield* Effect.fail(new NotFoundError({ resourceType: "User", id }));
          }
        }),
    };
  }),
}) {}
```

### Use Effect.gen for Business Logic

```typescript
const registerUser = (email: Email, name: string) =>
  Effect.gen(function* () {
    const users = yield* UserService;

    // Check for existing user
    const existing = yield* users.findByEmail(email);
    if (Option.isSome(existing)) {
      return yield* Effect.fail(
        new ConflictError({
          message: "Email already registered",
        }),
      );
    }

    // Create new user
    const user = yield* users.create({
      email,
      name,
      role: "user",
    });

    // Send welcome email
    yield* EmailService.send({
      to: email,
      template: "welcome",
      data: { name },
    });

    return user;
  });
```

### Avoid Long .andThen Chains

```typescript
// BAD: Hard to read and debug
const result = validateInput(data)
  .pipe(Effect.andThen(checkPermissions))
  .pipe(Effect.andThen(fetchDependencies))
  .pipe(Effect.andThen(processData))
  .pipe(Effect.andThen(saveResult));

// GOOD: Use Effect.gen for sequential logic
const result = Effect.gen(function* () {
  const validated = yield* validateInput(data);
  yield* checkPermissions(validated);
  const deps = yield* fetchDependencies(validated);
  const processed = yield* processData(validated, deps);
  return yield* saveResult(processed);
});
```
