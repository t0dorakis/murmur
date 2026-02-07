# Schema Patterns (77 patterns)

Validation with primitives, objects, arrays, unions, transformations, and async validation.

## Table of Contents

- [Getting Started](#getting-started)
- [Primitives](#primitives)
- [Objects](#objects)
- [Arrays & Tuples](#arrays--tuples)
- [Unions](#unions)
- [Composition](#composition)
- [Transformations](#transformations)
- [Error Handling](#error-handling)
- [Async Validation](#async-validation)
- [Real-World Patterns](#real-world-patterns)

---

## Getting Started

### Basic Decode/Encode

```typescript
import { Schema } from "effect";

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  age: Schema.Number,
});

// Decode unknown data (validates)
const parseUser = Schema.decodeUnknown(User);
const user = Effect.runSync(parseUser({ id: "1", name: "Alice", age: 30 }));

// Encode (validates output)
const encodeUser = Schema.encode(User);
const json = Effect.runSync(encodeUser(user));
```

### Schema vs Zod

- Schema integrates with Effect's error channel
- Schema supports bidirectional transformations
- Schema has better TypeScript inference
- Schema supports async validation natively

---

## Primitives

### String Validation

```typescript
Schema.String; // Any string
Schema.String.pipe(Schema.nonEmptyString()); // Non-empty
Schema.String.pipe(Schema.minLength(3)); // Min length
Schema.String.pipe(Schema.maxLength(100)); // Max length
Schema.String.pipe(Schema.length(5)); // Exact length
Schema.String.pipe(Schema.pattern(/^[A-Z]/)); // Regex pattern
Schema.String.pipe(Schema.trimmed()); // Trims whitespace
Schema.String.pipe(Schema.lowercased()); // Lowercased
Schema.String.pipe(Schema.uppercased()); // Uppercased
```

### Number Validation

```typescript
Schema.Number; // Any number
Schema.Number.pipe(Schema.int()); // Integer only
Schema.Number.pipe(Schema.positive()); // > 0
Schema.Number.pipe(Schema.negative()); // < 0
Schema.Number.pipe(Schema.nonNegative()); // >= 0
Schema.Number.pipe(Schema.between(1, 100)); // Range
Schema.Number.pipe(Schema.greaterThan(0)); // > value
Schema.Number.pipe(Schema.lessThanOrEqualTo(100)); // <= value
Schema.Number.pipe(Schema.finite()); // Not Infinity/NaN
```

### Boolean, Null, Undefined

```typescript
Schema.Boolean;
Schema.Null;
Schema.Undefined;
Schema.Void;
```

### Literals & Enums

```typescript
// Literal
Schema.Literal("active");
Schema.Literal(42);
Schema.Literal(true);

// Union of literals (enum-like)
const Status = Schema.Literal("pending", "active", "completed");

// TypeScript enum
enum Role {
  Admin,
  User,
  Guest,
}
const RoleSchema = Schema.Enums(Role);

// Template literal
const UserId = Schema.TemplateLiteral(Schema.Literal("user_"), Schema.String);
// Matches: "user_123", "user_abc"
```

### Dates

```typescript
// Date object
Schema.Date;

// Parse from string
Schema.DateFromString; // ISO string -> Date

// With validation
Schema.Date.pipe(Schema.validDate()); // No Invalid Date
```

---

## Objects

### Basic Struct

```typescript
const User = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  age: Schema.Number,
});

type User = Schema.Schema.Type<typeof User>;
// { id: string; email: string; age: number }
```

### Optional Fields

```typescript
const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  nickname: Schema.optional(Schema.String), // string | undefined
  bio: Schema.optional(Schema.String, { exact: true }), // string | undefined (strict)
  avatar: Schema.optionalWith(Schema.String, { default: () => "/default.png" }),
});
```

### Readonly

```typescript
const Config = Schema.Struct({
  apiKey: Schema.String,
  endpoint: Schema.String,
}).pipe(Schema.mutable); // Remove readonly
```

### Nested Objects

```typescript
const Address = Schema.Struct({
  street: Schema.String,
  city: Schema.String,
  country: Schema.String,
});

const User = Schema.Struct({
  name: Schema.String,
  address: Address,
});
```

### Records (Dynamic Keys)

```typescript
// Record<string, number>
const Scores = Schema.Record({ key: Schema.String, value: Schema.Number });

// With key validation
const UserScores = Schema.Record({
  key: Schema.String.pipe(Schema.pattern(/^user_/)),
  value: Schema.Number.pipe(Schema.nonNegative()),
});
```

---

## Arrays & Tuples

### Arrays

```typescript
Schema.Array(Schema.String); // string[]

// With constraints
Schema.Array(Schema.String).pipe(Schema.minItems(1), Schema.maxItems(10));

// Non-empty array
Schema.NonEmptyArray(Schema.String);
```

### Tuples

```typescript
// Fixed length
const Point = Schema.Tuple(Schema.Number, Schema.Number);
// [number, number]

// With rest
const AtLeastTwo = Schema.Tuple(
  [Schema.String, Schema.String], // Required
  Schema.String, // Rest
);
// [string, string, ...string[]]
```

---

## Unions

### Basic Union

```typescript
const StringOrNumber = Schema.Union(Schema.String, Schema.Number);
```

### Discriminated Union (Recommended)

```typescript
const Dog = Schema.Struct({
  _tag: Schema.Literal("Dog"),
  name: Schema.String,
  breed: Schema.String,
});

const Cat = Schema.Struct({
  _tag: Schema.Literal("Cat"),
  name: Schema.String,
  indoor: Schema.Boolean,
});

const Pet = Schema.Union(Dog, Cat);

// Pattern match
const describe = (pet: Schema.Schema.Type<typeof Pet>) => {
  switch (pet._tag) {
    case "Dog":
      return `${pet.name} is a ${pet.breed}`;
    case "Cat":
      return `${pet.name} is ${pet.indoor ? "indoor" : "outdoor"}`;
  }
};
```

### Nullable/Optional

```typescript
Schema.NullOr(Schema.String); // string | null
Schema.UndefinedOr(Schema.String); // string | undefined
Schema.NullishOr(Schema.String); // string | null | undefined
Schema.OptionFromNullOr(Schema.String); // Option<string>
```

---

## Composition

### Extend

```typescript
const Person = Schema.Struct({
  name: Schema.String,
  age: Schema.Number,
});

const Employee = Schema.extend(
  Person,
  Schema.Struct({
    employeeId: Schema.String,
    department: Schema.String,
  }),
);
```

### Pick & Omit

```typescript
const UserSummary = User.pipe(Schema.pick("id", "name"));
const UserWithoutPassword = User.pipe(Schema.omit("password"));
```

### Merge

```typescript
const Combined = Schema.merge(SchemaA, SchemaB);
```

### Partial & Required

```typescript
const PartialUser = Schema.partial(User); // All fields optional
const RequiredUser = Schema.required(User); // All fields required
```

---

## Transformations

### Basic Transform

```typescript
// String to number
const NumberFromString = Schema.transform(Schema.String, Schema.Number, {
  decode: (s) => parseFloat(s),
  encode: (n) => String(n),
});
```

### Transform with Validation

```typescript
const PositiveFromString = Schema.transformOrFail(
  Schema.String,
  Schema.Number.pipe(Schema.positive()),
  {
    decode: (s, _, ast) => {
      const n = parseFloat(s);
      return isNaN(n)
        ? ParseResult.fail(new ParseResult.Type(ast, s, "Not a number"))
        : ParseResult.succeed(n);
    },
    encode: (n) => ParseResult.succeed(String(n)),
  },
);
```

### Built-in Transformations

```typescript
Schema.NumberFromString; // "123" -> 123
Schema.DateFromString; // "2024-01-01" -> Date
Schema.BooleanFromString; // "true"/"false" -> boolean
Schema.split(","); // "a,b,c" -> ["a", "b", "c"]
Schema.Trim; // "  hello  " -> "hello"
Schema.Lowercase; // "HELLO" -> "hello"
```

### Branded Types

```typescript
const UserId = Schema.String.pipe(Schema.brand("UserId"));
type UserId = Schema.Schema.Type<typeof UserId>;
// string & Brand<"UserId">

// With validation
const Email = Schema.String.pipe(Schema.pattern(/@/), Schema.brand("Email"));
```

---

## Error Handling

### Custom Error Messages

```typescript
const Age = Schema.Number.pipe(
  Schema.between(0, 150),
  Schema.message(() => "Age must be between 0 and 150"),
);
```

### Tagged Errors

```typescript
class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
  readonly message: string;
}> {}

const validateUser = (data: unknown) =>
  Schema.decodeUnknown(User)(data).pipe(
    Effect.mapError(
      (e) =>
        new ValidationError({
          field: "user",
          message: TreeFormatter.formatError(e),
        }),
    ),
  );
```

### Collect All Errors

```typescript
const result = Schema.decodeUnknownEither(User)(data, {
  errors: "all", // Collect all errors, not just first
});
```

---

## Async Validation

### Basic Async

```typescript
const UniqueEmail = Schema.String.pipe(
  Schema.filterEffect((email) =>
    Effect.gen(function* () {
      const exists = yield* checkEmailExists(email);
      return !exists;
    }),
  ),
);
```

### With Dependencies

```typescript
const UniqueUsername = Schema.String.pipe(
  Schema.filterEffect((username) =>
    Effect.gen(function* () {
      const db = yield* Database;
      const exists = yield* db.userExists(username);
      return !exists;
    }),
  ),
);

// Provide dependencies when decoding
const parseUser = Schema.decodeUnknown(UserWithUniqueUsername);
const result = yield * parseUser(data).pipe(Effect.provide(DatabaseLive));
```

---

## Real-World Patterns

### API Response Validation

```typescript
const ApiResponse = <T extends Schema.Schema.Any>(data: T) =>
  Schema.Struct({
    success: Schema.Boolean,
    data: data,
    timestamp: Schema.DateFromString,
  });

const UserResponse = ApiResponse(User);
```

### Form Validation

```typescript
const RegistrationForm = Schema.Struct({
  email: Schema.String.pipe(
    Schema.pattern(/@/),
    Schema.message(() => "Invalid email format"),
  ),
  password: Schema.String.pipe(
    Schema.minLength(8),
    Schema.message(() => "Password must be at least 8 characters"),
  ),
  confirmPassword: Schema.String,
}).pipe(
  Schema.filter((form) => form.password === form.confirmPassword, {
    message: () => "Passwords don't match",
  }),
);
```

### Environment Config

```typescript
const EnvConfig = Schema.Struct({
  PORT: Schema.NumberFromString.pipe(Schema.int(), Schema.between(1, 65535)),
  DATABASE_URL: Schema.String.pipe(Schema.startsWith("postgres://")),
  API_KEY: Schema.Redacted(Schema.String),
  DEBUG: Schema.optional(Schema.BooleanFromString, { default: () => false }),
});

const config = yield * Schema.decodeUnknown(EnvConfig)(process.env);
```

### JSON Columns (Postgres JSONB)

```typescript
const UserPreferences = Schema.Struct({
  theme: Schema.Literal("light", "dark"),
  notifications: Schema.Boolean,
  language: Schema.String,
});

// Parse from string (database JSON column)
const PreferencesFromJson = Schema.parseJson(UserPreferences);
```

### Recursive Structures

```typescript
interface Category {
  name: string;
  children: readonly Category[];
}

const Category: Schema.Schema<Category> = Schema.Struct({
  name: Schema.String,
  children: Schema.Array(Schema.suspend(() => Category)),
});
```
