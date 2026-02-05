# Stream Patterns (18 patterns)

Process data sequences with map, filter, merge, backpressure, and sinks.

## Table of Contents
- [Stream Basics](#stream-basics)
- [Creating Streams](#creating-streams)
- [Transformations](#transformations)
- [Combining Streams](#combining-streams)
- [Stateful Operations](#stateful-operations)
- [Backpressure & Buffering](#backpressure--buffering)
- [Sinks](#sinks)
- [Error Handling](#error-handling)
- [Resource Management](#resource-management)

---

## Stream Basics

### Stream vs Effect
- **Effect<A>**: Single value (like Promise)
- **Stream<A>**: Sequence of values over time (like AsyncIterable)

Use Stream when:
- Processing files line-by-line
- Handling paginated API responses
- Processing events/messages
- Memory-efficient data pipelines

### Running Streams
```typescript
import { Stream, Chunk } from "effect"

// Collect all into Chunk
const results = yield* Stream.fromIterable([1, 2, 3]).pipe(
  Stream.runCollect
)  // Chunk(1, 2, 3)

// Collect into array
const array = yield* Stream.fromIterable([1, 2, 3]).pipe(
  Stream.runCollect,
  Effect.map(Chunk.toArray)
)

// Run for side effects only
yield* Stream.fromIterable([1, 2, 3]).pipe(
  Stream.runForEach((n) => Effect.log(`Got: ${n}`))
)

// Drain (ignore results)
yield* Stream.fromIterable([1, 2, 3]).pipe(
  Stream.runDrain
)
```

---

## Creating Streams

### From Collections
```typescript
Stream.fromIterable([1, 2, 3])
Stream.fromChunk(Chunk.make(1, 2, 3))
Stream.range(1, 10)  // 1 to 10
```

### From Effects
```typescript
// Single effect
Stream.fromEffect(fetchUser(id))

// Repeated effect
Stream.repeatEffect(Effect.sync(() => Math.random()))

// With schedule
Stream.repeatEffectWithSchedule(
  fetchPrice(),
  Schedule.spaced("1 second")
)
```

### From Async Sources
```typescript
// From async iterable
Stream.fromAsyncIterable(
  asyncGenerator(),
  (e) => new StreamError(String(e))
)

// From queue
Stream.fromQueue(queue)

// From PubSub subscription
Stream.fromPubSub(pubsub)
```

### Pagination Pattern
```typescript
const fetchAllPages = Stream.paginateEffect(1, (page) =>
  Effect.gen(function* () {
    const response = yield* fetchPage(page)
    const next = response.hasMore ? Option.some(page + 1) : Option.none()
    return [response.items, next]
  })
)
```

---

## Transformations

### map - Transform Elements
```typescript
Stream.fromIterable([1, 2, 3]).pipe(
  Stream.map((n) => n * 2)
)  // 2, 4, 6
```

### mapEffect - Effectful Transform
```typescript
Stream.fromIterable(userIds).pipe(
  Stream.mapEffect((id) => fetchUser(id))
)
```

### filter - Keep Matching Elements
```typescript
Stream.fromIterable([1, 2, 3, 4, 5]).pipe(
  Stream.filter((n) => n % 2 === 0)
)  // 2, 4
```

### flatMap - Flatten Nested Streams
```typescript
Stream.fromIterable(departments).pipe(
  Stream.flatMap((dept) => Stream.fromIterable(dept.employees))
)
```

### take/drop - Limit Elements
```typescript
stream.pipe(Stream.take(10))      // First 10
stream.pipe(Stream.drop(5))       // Skip first 5
stream.pipe(Stream.takeWhile((n) => n < 100))
stream.pipe(Stream.dropWhile((n) => n < 10))
```

### Chunking
```typescript
stream.pipe(Stream.grouped(100))     // Groups of 100
stream.pipe(Stream.groupedWithin(100, "1 second"))  // Time or count
```

---

## Combining Streams

### merge - Interleave Elements
```typescript
const combined = Stream.merge(streamA, streamB)
// Elements arrive in order they're produced
```

### mergeAll - Merge Multiple
```typescript
const combined = Stream.mergeAll(3)([
  stream1,
  stream2,
  stream3
])
// Merge with concurrency limit
```

### concat - Sequential
```typescript
const combined = Stream.concat(streamA, streamB)
// All of A, then all of B
```

### zip - Pair Elements
```typescript
const paired = Stream.zip(streamA, streamB)
// [a1, b1], [a2, b2], ...
```

### zipWith - Combine Elements
```typescript
const combined = Stream.zipWith(
  prices,
  quantities,
  (price, qty) => price * qty
)
```

---

## Stateful Operations

### scan - Running Accumulator
```typescript
Stream.fromIterable([1, 2, 3, 4, 5]).pipe(
  Stream.scan(0, (acc, n) => acc + n)
)  // 0, 1, 3, 6, 10, 15 (running sum)
```

### fold/reduce - Final Accumulator
```typescript
const sum = yield* Stream.fromIterable([1, 2, 3]).pipe(
  Stream.runFold(0, (acc, n) => acc + n)
)  // 6
```

### Grouping
```typescript
// Group by key and process each group
Stream.fromIterable(events).pipe(
  Stream.groupByKey((event) => event.userId),
  Stream.flatMap(([userId, eventStream]) =>
    eventStream.pipe(Stream.take(10))
  )
)
```

---

## Backpressure & Buffering

### Buffer
```typescript
stream.pipe(Stream.buffer({ capacity: 100 }))
```

### Throttle
```typescript
stream.pipe(
  Stream.throttle({
    cost: () => 1,
    duration: "1 second",
    units: 10  // 10 per second max
  })
)
```

### Debounce
```typescript
stream.pipe(Stream.debounce("500 millis"))
```

### Sliding Window
```typescript
stream.pipe(Stream.sliding(5))  // Groups of 5, sliding by 1
```

---

## Sinks

Sinks consume streams and produce results.

### Built-in Sinks
```typescript
// Collect all
const items = yield* stream.pipe(Stream.run(Sink.collectAll()))

// Take first N
const first5 = yield* stream.pipe(Stream.run(Sink.take(5)))

// Sum
const total = yield* stream.pipe(Stream.run(Sink.sum))

// Count
const count = yield* stream.pipe(Stream.run(Sink.count))

// Fold
const result = yield* stream.pipe(
  Stream.run(Sink.foldLeft(0, (acc, n) => acc + n))
)
```

### Custom Sink for Batching
```typescript
const batchInsert = Sink.foldChunksEffect(
  0,
  () => true,
  (count, chunk) =>
    Effect.gen(function* () {
      yield* db.insertMany(Chunk.toArray(chunk))
      return count + Chunk.size(chunk)
    })
)

const inserted = yield* stream.pipe(
  Stream.grouped(100),  // Batch size
  Stream.run(batchInsert)
)
```

---

## Error Handling

### catchAll - Recover from Errors
```typescript
stream.pipe(
  Stream.catchAll((error) => Stream.succeed(defaultValue))
)
```

### retry - Retry on Failure
```typescript
stream.pipe(
  Stream.retry(Schedule.exponential("1 second").pipe(Schedule.recurs(3)))
)
```

### orElse - Fallback Stream
```typescript
primaryStream.pipe(
  Stream.orElse(() => fallbackStream)
)
```

---

## Resource Management

### Scoped Streams
```typescript
const fileLines = Stream.scoped(
  Effect.acquireRelease(
    Effect.sync(() => openFile(path)),
    (handle) => Effect.sync(() => handle.close())
  )
).pipe(
  Stream.flatMap((handle) => Stream.fromAsyncIterable(handle.lines(), identity))
)
```

### Ensuring Cleanup
```typescript
stream.pipe(
  Stream.ensuring(Effect.log("Stream completed"))
)
```

### File Processing Example
```typescript
const processLargeFile = (path: string) =>
  Stream.fromReadableStream(
    () => fs.createReadStream(path),
    (e) => new FileError(String(e))
  ).pipe(
    Stream.splitLines,
    Stream.filter((line) => line.length > 0),
    Stream.map(parseLine),
    Stream.grouped(1000),
    Stream.mapEffect((batch) => processBatch(batch)),
    Stream.runDrain
  )
```
