# Observability Patterns (13 patterns)

Logging, metrics, tracing, spans, OpenTelemetry, Prometheus.

## Table of Contents

- [Logging](#logging)
- [Tracing](#tracing)
- [Metrics](#metrics)
- [Integration](#integration)

---

## Logging

### Built-in Log Functions

```typescript
yield * Effect.log("Basic info message");
yield * Effect.logDebug("Debug details");
yield * Effect.logInfo("Informational message");
yield * Effect.logWarning("Warning message");
yield * Effect.logError("Error occurred");
yield * Effect.logFatal("Critical failure");
```

### Structured Logging with Annotations

```typescript
const processOrder = (orderId: string) =>
  Effect.gen(function* () {
    yield* Effect.log("Processing order");
    yield* validateOrder(orderId);
    yield* chargePayment(orderId);
    yield* fulfillOrder(orderId);
    yield* Effect.log("Order completed");
  }).pipe(
    Effect.annotateLogs("orderId", orderId),
    Effect.annotateLogs("service", "order-processor"),
  );
```

### Log Spans for Timing

```typescript
const processWithTiming = Effect.gen(function* () {
  yield* Effect.logSpan("database-query")(databaseQuery());

  yield* Effect.logSpan("external-api-call")(callExternalApi());

  yield* Effect.logSpan("data-transformation")(transformData());
});
```

### Custom Logger

```typescript
const JsonLogger = Logger.make(({ logLevel, message, annotations, spans }) => {
  const log = {
    timestamp: new Date().toISOString(),
    level: logLevel.label,
    message,
    ...Object.fromEntries(annotations),
    spans: spans.map((s) => s[0]),
  };
  console.log(JSON.stringify(log));
});

const program = myEffect.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, JsonLogger)));
```

### Conditional Logging

```typescript
const verboseLogging = (enabled: boolean) =>
  enabled ? Logger.withMinimumLogLevel(LogLevel.Debug) : Logger.withMinimumLogLevel(LogLevel.Info);

const program = myEffect.pipe(Effect.provide(verboseLogging(process.env.DEBUG === "true")));
```

---

## Tracing

### Add Spans

```typescript
const fetchUser = (id: string) =>
  Effect.gen(function* () {
    yield* Effect.log("Fetching user");
    const user = yield* database.findById(id);
    yield* Effect.log("User found");
    return user;
  }).pipe(Effect.withSpan("fetchUser", { attributes: { userId: id } }));
```

### Nested Spans

```typescript
const processRequest = (requestId: string) =>
  Effect.gen(function* () {
    const user = yield* fetchUser(userId).pipe(Effect.withSpan("fetchUser"));

    const permissions = yield* checkPermissions(user).pipe(Effect.withSpan("checkPermissions"));

    const result = yield* executeAction(user, permissions).pipe(Effect.withSpan("executeAction"));

    return result;
  }).pipe(
    Effect.withSpan("processRequest", {
      attributes: { requestId },
    }),
  );
```

### Manual Span Creation

```typescript
const program = Effect.gen(function* () {
  const tracer = yield* Tracer.Tracer;

  yield* tracer.withSpan("manual-span", (span) =>
    Effect.gen(function* () {
      span.attribute("key", "value");
      span.event("checkpoint", Date.now());

      const result = yield* doWork();

      span.attribute("result.count", result.length);
      return result;
    }),
  );
});
```

### Error Recording

```typescript
const withErrorTracking = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.tapError((error) =>
      Effect.gen(function* () {
        const tracer = yield* Tracer.Tracer;
        yield* tracer.currentSpan.pipe(
          Effect.tap((span) =>
            Effect.sync(() => {
              span.status({ _tag: "Error", message: String(error) });
              span.event("error", Date.now(), { error: String(error) });
            }),
          ),
        );
      }),
    ),
  );
```

---

## Metrics

### Counter

```typescript
const requestCounter = Metric.counter("http_requests_total", {
  description: "Total HTTP requests",
  incremental: true,
});

const handleRequest = Effect.gen(function* () {
  yield* Metric.increment(requestCounter);
  // ... handle request
});

// With labels
const labeledCounter = Metric.counter("http_requests_total").pipe(
  Metric.taggedWithLabels(["method", "path", "status"]),
);

const trackRequest = (method: string, path: string, status: number) =>
  Metric.increment(labeledCounter, {
    method,
    path,
    status: String(status),
  });
```

### Gauge

```typescript
const activeConnections = Metric.gauge("active_connections", {
  description: "Current active connections",
});

const connectionPool = Effect.gen(function* () {
  yield* Metric.set(activeConnections, 0);

  const connect = Effect.gen(function* () {
    yield* Metric.increment(activeConnections);
    // ... create connection
  });

  const disconnect = Effect.gen(function* () {
    yield* Metric.decrement(activeConnections);
    // ... close connection
  });

  return { connect, disconnect };
});
```

### Histogram

```typescript
const responseTime = Metric.histogram("http_response_time_seconds", {
  description: "HTTP response time",
  boundaries: [0.01, 0.05, 0.1, 0.5, 1, 5],
});

const timedRequest = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const start = Date.now();
    const result = yield* effect;
    const duration = (Date.now() - start) / 1000;

    yield* Metric.update(responseTime, duration);
    return result;
  });
```

### Summary

```typescript
const requestSize = Metric.summary("http_request_size_bytes", {
  description: "HTTP request body size",
  maxAge: "5 minutes",
  maxSize: 1000,
  quantiles: [0.5, 0.9, 0.99],
});

const trackRequestSize = (bytes: number) => Metric.update(requestSize, bytes);
```

---

## Integration

### OpenTelemetry Setup

```typescript
import { NodeSdk } from "@effect/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";

const OtelLive = NodeSdk.layer(() => ({
  resource: { serviceName: "my-service" },
  spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter()),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
    exportIntervalMillis: 10000,
  }),
}));

const program = myEffect.pipe(Effect.provide(OtelLive));
```

### Prometheus Export

```typescript
import { PrometheusClient } from "@effect/metrics-prometheus";

const PrometheusLive = PrometheusClient.layer;

const metricsEndpoint = HttpRouter.get(
  "/metrics",
  Effect.gen(function* () {
    const prometheus = yield* PrometheusClient;
    const metrics = yield* prometheus.get();
    return HttpServerResponse.text(metrics, {
      headers: { "Content-Type": "text/plain" },
    });
  }),
);
```

### Distributed Tracing Context

```typescript
// Extract trace context from headers
const extractTraceContext = (headers: Headers) =>
  Effect.gen(function* () {
    const tracer = yield* Tracer.Tracer;
    const traceId = headers.get("x-trace-id");
    const spanId = headers.get("x-span-id");

    if (traceId && spanId) {
      return yield* tracer.withSpan("incoming-request", {
        parent: { traceId, spanId },
      });
    }

    return yield* tracer.withSpan("incoming-request");
  });

// Propagate trace context to outgoing requests
const propagateTraceContext = (request: Request) =>
  Effect.gen(function* () {
    const tracer = yield* Tracer.Tracer;
    const span = yield* tracer.currentSpan;

    return new Request(request.url, {
      ...request,
      headers: {
        ...Object.fromEntries(request.headers),
        "x-trace-id": span.traceId,
        "x-span-id": span.spanId,
      },
    });
  });
```

### Health Check with Metrics

```typescript
const healthCheck = Effect.gen(function* () {
  const start = Date.now();

  const checks = yield* Effect.all({
    database: checkDatabase().pipe(Effect.either),
    cache: checkCache().pipe(Effect.either),
    queue: checkQueue().pipe(Effect.either),
  });

  const healthy = Object.values(checks).every(Either.isRight);
  const duration = Date.now() - start;

  yield* Metric.update(responseTime, duration / 1000);
  yield* Metric.set(Metric.gauge("health_check_status"), healthy ? 1 : 0);

  return {
    status: healthy ? "healthy" : "unhealthy",
    checks: Object.fromEntries(
      Object.entries(checks).map(([k, v]) => [k, Either.isRight(v) ? "ok" : "fail"]),
    ),
    durationMs: duration,
  };
});
```
