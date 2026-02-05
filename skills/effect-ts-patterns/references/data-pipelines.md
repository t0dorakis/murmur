# Data Pipeline Patterns (14 patterns)

Stream processing, pagination, batching, fan-out, backpressure.

## Table of Contents
- [Pipeline Basics](#pipeline-basics)
- [Reading Data](#reading-data)
- [Processing Patterns](#processing-patterns)
- [Writing Data](#writing-data)
- [Reliability Patterns](#reliability-patterns)

---

## Pipeline Basics

### Create Pipeline from Iterable
```typescript
import { Stream, Chunk } from "effect"

const pipeline = Stream.fromIterable([1, 2, 3, 4, 5]).pipe(
  Stream.map((n) => n * 2),
  Stream.filter((n) => n > 4),
  Stream.runCollect
)

const results = yield* pipeline  // Chunk(6, 8, 10)
```

### Run for Side Effects
```typescript
yield* Stream.fromIterable(items).pipe(
  Stream.tap((item) => Effect.log(`Processing: ${item.id}`)),
  Stream.mapEffect((item) => processItem(item)),
  Stream.runDrain  // Discard results, run for effects
)
```

### Collect Results
```typescript
// Into Chunk
const chunk = yield* pipeline.pipe(Stream.runCollect)

// Into array
const array = Chunk.toArray(yield* pipeline.pipe(Stream.runCollect))

// First element
const first = yield* pipeline.pipe(Stream.runHead)  // Option<A>

// Last element
const last = yield* pipeline.pipe(Stream.runLast)  // Option<A>
```

---

## Reading Data

### From File (Line by Line)
```typescript
const processFile = (path: string) =>
  Stream.fromReadableStream(
    () => fs.createReadStream(path),
    (e) => new FileError(String(e))
  ).pipe(
    Stream.splitLines,
    Stream.filter((line) => line.trim().length > 0)
  )
```

### From Paginated API
```typescript
interface Page<T> {
  items: T[]
  nextCursor: string | null
}

const fetchAllPages = <T>(
  fetchPage: (cursor: string | null) => Effect.Effect<Page<T>, ApiError>
) =>
  Stream.paginateEffect<T[], string | null, ApiError>(null, (cursor) =>
    Effect.gen(function* () {
      const page = yield* fetchPage(cursor)
      const next = page.nextCursor ? Option.some(page.nextCursor) : Option.none()
      return [page.items, next]
    })
  ).pipe(Stream.flatMap(Stream.fromIterable))
```

### From Database Cursor
```typescript
const streamUsers = Stream.paginateChunkEffect(0, (offset) =>
  Effect.gen(function* () {
    const db = yield* Database
    const users = yield* db.query(
      "SELECT * FROM users LIMIT 1000 OFFSET ?",
      [offset]
    )

    const chunk = Chunk.fromIterable(users)
    const next = Chunk.size(chunk) === 1000
      ? Option.some(offset + 1000)
      : Option.none()

    return [chunk, next]
  })
)
```

### From Queue
```typescript
const processQueue = (queue: Queue.Queue<Task>) =>
  Stream.fromQueue(queue).pipe(
    Stream.mapEffect((task) => processTask(task)),
    Stream.runDrain
  )
```

---

## Processing Patterns

### Concurrent Processing
```typescript
const pipeline = Stream.fromIterable(urls).pipe(
  Stream.mapEffect(
    (url) => fetchUrl(url),
    { concurrency: 10 }  // Process 10 at a time
  ),
  Stream.runCollect
)
```

### Batching
```typescript
const insertInBatches = Stream.fromIterable(records).pipe(
  Stream.grouped(100),  // Groups of 100
  Stream.mapEffect((batch) => db.insertMany(Chunk.toArray(batch))),
  Stream.runDrain
)
```

### Time-Based Batching
```typescript
const batchByTime = Stream.fromQueue(eventQueue).pipe(
  Stream.groupedWithin(100, "5 seconds"),  // Max 100 or 5 seconds
  Stream.mapEffect((batch) => processBatch(batch))
)
```

### Fan-Out / Fan-In
```typescript
const fanOut = (items: Iterable<Item>, workers: number) =>
  Effect.gen(function* () {
    const queue = yield* Queue.bounded<Item>(100)
    const results = yield* Queue.unbounded<Result>()

    // Producer
    yield* Effect.fork(
      Effect.forEach(items, (item) => Queue.offer(queue, item)).pipe(
        Effect.andThen(Queue.shutdown(queue))
      )
    )

    // Workers
    yield* Effect.all(
      Array.from({ length: workers }, () =>
        Effect.fork(
          Effect.forever(
            Effect.gen(function* () {
              const item = yield* Queue.take(queue)
              const result = yield* processItem(item)
              yield* Queue.offer(results, result)
            })
          ).pipe(Effect.catchTag("QueueClosed", () => Effect.void))
        )
      )
    )

    return Stream.fromQueue(results)
  })
```

### Grouping by Key
```typescript
const groupedProcessing = Stream.fromIterable(events).pipe(
  Stream.groupBy((event) => event.userId),
  Stream.flatMapGrouped((userId, userEvents) =>
    userEvents.pipe(
      Stream.scan(initialState, (state, event) => reducer(state, event)),
      Stream.runLast
    )
  )
)
```

---

## Writing Data

### To File
```typescript
const writeLines = (path: string, lines: Stream.Stream<string>) =>
  lines.pipe(
    Stream.intersperse("\n"),
    Stream.encodeText,
    Stream.run(Sink.fromWritable(() => fs.createWriteStream(path)))
  )
```

### Batch Insert to Database
```typescript
const batchInsert = <T>(
  stream: Stream.Stream<T>,
  insert: (batch: T[]) => Effect.Effect<void>,
  batchSize: number = 100
) =>
  stream.pipe(
    Stream.grouped(batchSize),
    Stream.mapEffect((batch) => insert(Chunk.toArray(batch))),
    Stream.runDrain
  )
```

### To Multiple Destinations
```typescript
const tee = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  destinations: Array<(a: A) => Effect.Effect<void>>
) =>
  stream.pipe(
    Stream.tap((a) => Effect.all(destinations.map((dest) => dest(a)))),
    Stream.runDrain
  )
```

---

## Reliability Patterns

### Retry Failed Operations
```typescript
const reliablePipeline = Stream.fromIterable(items).pipe(
  Stream.mapEffect(
    (item) => processItem(item).pipe(
      Effect.retry(Schedule.exponential("1 second").pipe(Schedule.recurs(3)))
    )
  ),
  Stream.runDrain
)
```

### Dead Letter Queue
```typescript
const withDeadLetter = <A>(
  stream: Stream.Stream<A>,
  process: (a: A) => Effect.Effect<void>,
  deadLetter: Queue.Queue<A>
) =>
  stream.pipe(
    Stream.mapEffect((item) =>
      process(item).pipe(
        Effect.catchAll(() =>
          Queue.offer(deadLetter, item).pipe(
            Effect.andThen(Effect.log(`DLQ: ${JSON.stringify(item)}`))
          )
        )
      )
    ),
    Stream.runDrain
  )
```

### Checkpointing
```typescript
interface Checkpoint {
  offset: number
  timestamp: Date
}

const processWithCheckpoint = (
  stream: Stream.Stream<Record>,
  saveCheckpoint: (cp: Checkpoint) => Effect.Effect<void>
) =>
  stream.pipe(
    Stream.zipWithIndex,
    Stream.tap(([_, index]) => {
      if (index % 1000 === 0) {
        return saveCheckpoint({ offset: index, timestamp: new Date() })
      }
      return Effect.void
    }),
    Stream.map(([record, _]) => record)
  )
```

### Backpressure Handling
```typescript
// Buffer to handle bursts
const bufferedPipeline = fastProducer.pipe(
  Stream.buffer({ capacity: 1000 }),
  Stream.mapEffect(slowConsumer)
)

// Throttle to limit rate
const throttledPipeline = stream.pipe(
  Stream.throttle({
    cost: () => 1,
    duration: "1 second",
    units: 100  // Max 100 per second
  })
)

// Drop excess with sliding buffer
const slidingPipeline = stream.pipe(
  Stream.buffer({ capacity: 100, strategy: "sliding" })
)
```

### Progress Tracking
```typescript
const withProgress = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  total: number,
  onProgress: (current: number, total: number) => Effect.Effect<void>
) =>
  stream.pipe(
    Stream.zipWithIndex,
    Stream.tap(([_, index]) => {
      if (index % 100 === 0 || index === total - 1) {
        return onProgress(index + 1, total)
      }
      return Effect.void
    }),
    Stream.map(([item, _]) => item)
  )
```
