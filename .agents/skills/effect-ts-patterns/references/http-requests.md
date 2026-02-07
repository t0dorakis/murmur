# HTTP Requests Patterns (10 patterns)

HTTP client, timeouts, caching, response parsing, retries.

## Table of Contents

- [Basic Requests](#basic-requests)
- [Request Configuration](#request-configuration)
- [Response Handling](#response-handling)
- [Reliability Patterns](#reliability-patterns)
- [Advanced Patterns](#advanced-patterns)

---

## Basic Requests

### Simple GET Request

```typescript
import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform";

const fetchUser = (id: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const response = yield* client.execute(
      HttpClientRequest.get(`https://api.example.com/users/${id}`),
    );

    return yield* HttpClientResponse.json(response);
  });
```

### POST with JSON Body

```typescript
const createUser = (user: CreateUserRequest) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const response = yield* client.execute(
      HttpClientRequest.post("https://api.example.com/users").pipe(
        HttpClientRequest.jsonBody(user),
      ),
    );

    return yield* HttpClientResponse.json(response);
  });
```

### With Headers

```typescript
const fetchWithAuth = (url: string, token: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const response = yield* client.execute(
      HttpClientRequest.get(url).pipe(
        HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
        HttpClientRequest.setHeader("Accept", "application/json"),
      ),
    );

    return yield* HttpClientResponse.json(response);
  });
```

---

## Request Configuration

### Timeout

```typescript
const fetchWithTimeout = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const response = yield* client
      .execute(HttpClientRequest.get(url))
      .pipe(Effect.timeout("10 seconds"));

    if (Option.isNone(response)) {
      return yield* Effect.fail(new TimeoutError({ url }));
    }

    return yield* HttpClientResponse.json(response.value);
  });
```

### Query Parameters

```typescript
const searchUsers = (query: string, page: number) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const response = yield* client.execute(
      HttpClientRequest.get("https://api.example.com/users").pipe(
        HttpClientRequest.setUrlParams({
          q: query,
          page: String(page),
          limit: "20",
        }),
      ),
    );

    return yield* HttpClientResponse.json(response);
  });
```

### Form Data

```typescript
const uploadFile = (file: Blob, name: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const formData = new FormData();
    formData.append("file", file, name);

    const response = yield* client.execute(
      HttpClientRequest.post("https://api.example.com/upload").pipe(
        HttpClientRequest.formDataBody(formData),
      ),
    );

    return yield* HttpClientResponse.json(response);
  });
```

---

## Response Handling

### Parse with Schema

```typescript
const User = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
});

const fetchUserTyped = (id: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const response = yield* client.execute(
      HttpClientRequest.get(`https://api.example.com/users/${id}`),
    );

    const json = yield* HttpClientResponse.json(response);

    return yield* Schema.decodeUnknown(User)(json);
  });
```

### Handle Status Codes

```typescript
const fetchWithErrorHandling = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const response = yield* client.execute(HttpClientRequest.get(url));

    if (response.status === 404) {
      return yield* Effect.fail(new NotFoundError({ url }));
    }

    if (response.status === 401) {
      return yield* Effect.fail(new UnauthorizedError());
    }

    if (response.status >= 400) {
      const body = yield* HttpClientResponse.text(response);
      return yield* Effect.fail(new HttpError({ status: response.status, body }));
    }

    return yield* HttpClientResponse.json(response);
  });
```

### Stream Response

```typescript
const downloadLargeFile = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const response = yield* client.execute(HttpClientRequest.get(url));

    return HttpClientResponse.stream(response);
  });
```

---

## Reliability Patterns

### Retry with Backoff

```typescript
const fetchWithRetry = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    return yield* client
      .execute(HttpClientRequest.get(url))
      .pipe(
        Effect.flatMap(HttpClientResponse.json),
        Effect.retry(
          Schedule.exponential("1 second").pipe(
            Schedule.compose(Schedule.recurs(3)),
            Schedule.jittered,
          ),
        ),
      );
  });
```

### Retry Only Transient Errors

```typescript
const isTransient = (error: unknown): boolean => {
  if (error instanceof HttpError) {
    return error.status >= 500 || error.status === 429;
  }
  return false;
};

const fetchWithSmartRetry = (url: string) =>
  fetchData(url).pipe(
    Effect.retry({
      schedule: Schedule.exponential("1 second").pipe(Schedule.recurs(3)),
      while: isTransient,
    }),
  );
```

### Circuit Breaker Pattern

```typescript
const createCircuitBreaker = (threshold: number, resetAfter: Duration.Duration) =>
  Effect.gen(function* () {
    const failures = yield* Ref.make(0);
    const lastFailure = yield* Ref.make<Option.Option<Date>>(Option.none());

    return {
      execute: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
          const failCount = yield* Ref.get(failures);
          const lastFail = yield* Ref.get(lastFailure);

          // Check if circuit is open
          if (failCount >= threshold) {
            const elapsed = Option.match(lastFail, {
              onNone: () => 0,
              onSome: (d) => Date.now() - d.getTime(),
            });

            if (elapsed < Duration.toMillis(resetAfter)) {
              return yield* Effect.fail(new CircuitOpenError());
            }

            // Reset for retry
            yield* Ref.set(failures, 0);
          }

          // Execute with failure tracking
          return yield* effect.pipe(
            Effect.tapError(() =>
              Effect.gen(function* () {
                yield* Ref.update(failures, (n) => n + 1);
                yield* Ref.set(lastFailure, Option.some(new Date()));
              }),
            ),
            Effect.tap(() => Ref.set(failures, 0)),
          );
        }),
    };
  });
```

---

## Advanced Patterns

### Request Caching

```typescript
const createCachedClient = (ttl: Duration.Duration) =>
  Effect.gen(function* () {
    const cache = yield* Ref.make(new Map<string, { data: unknown; expires: number }>());

    return {
      fetch: <A>(url: string, schema: Schema.Schema<A>) =>
        Effect.gen(function* () {
          const cached = yield* Ref.get(cache);
          const entry = cached.get(url);

          if (entry && entry.expires > Date.now()) {
            return Schema.decodeUnknownSync(schema)(entry.data);
          }

          const client = yield* HttpClient.HttpClient;
          const response = yield* client.execute(HttpClientRequest.get(url));
          const data = yield* HttpClientResponse.json(response);

          yield* Ref.update(cache, (m) => {
            const newMap = new Map(m);
            newMap.set(url, {
              data,
              expires: Date.now() + Duration.toMillis(ttl),
            });
            return newMap;
          });

          return yield* Schema.decodeUnknown(schema)(data);
        }),
    };
  });
```

### Request Deduplication

```typescript
const createDedupedClient = () =>
  Effect.gen(function* () {
    const inFlight = yield* Ref.make(new Map<string, Deferred.Deferred<unknown, Error>>());

    return {
      fetch: (url: string) =>
        Effect.gen(function* () {
          const pending = yield* Ref.get(inFlight);
          const existing = pending.get(url);

          if (existing) {
            return yield* Deferred.await(existing);
          }

          const deferred = yield* Deferred.make<unknown, Error>();
          yield* Ref.update(inFlight, (m) => new Map(m).set(url, deferred));

          const result = yield* Effect.tryPromise(() => fetch(url).then((r) => r.json())).pipe(
            Effect.tap((data) => Deferred.succeed(deferred, data)),
            Effect.tapError((e) => Deferred.fail(deferred, e as Error)),
            Effect.ensuring(
              Ref.update(inFlight, (m) => {
                const newMap = new Map(m);
                newMap.delete(url);
                return newMap;
              }),
            ),
          );

          return result;
        }),
    };
  });
```

### Rate Limited Client

```typescript
const createRateLimitedClient = (requestsPerSecond: number) =>
  Effect.gen(function* () {
    const semaphore = yield* Effect.makeSemaphore(requestsPerSecond);
    const client = yield* HttpClient.HttpClient;

    return {
      execute: (request: HttpClientRequest.HttpClientRequest) =>
        semaphore.withPermits(1)(
          Effect.gen(function* () {
            const response = yield* client.execute(request);
            yield* Effect.sleep("1 second");
            return response;
          }),
        ),
    };
  });
```

### Logging Middleware

```typescript
const withLogging = <A, E, R>(effect: Effect.Effect<A, E, R>, url: string, method: string) =>
  Effect.gen(function* () {
    const start = Date.now();
    yield* Effect.log(`--> ${method} ${url}`);

    const result = yield* effect.pipe(
      Effect.tapBoth({
        onFailure: (e) => Effect.log(`<-- ERROR ${Date.now() - start}ms: ${e}`),
        onSuccess: () => Effect.log(`<-- OK ${Date.now() - start}ms`),
      }),
    );

    return result;
  });
```
