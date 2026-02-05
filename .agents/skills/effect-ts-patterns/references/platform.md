# Platform Patterns (8 patterns)

Filesystem, terminal I/O, command execution, environment variables, key-value storage, paths.

## Table of Contents
- [Filesystem Operations](#filesystem-operations)
- [Terminal I/O](#terminal-io)
- [Command Execution](#command-execution)
- [Environment Variables](#environment-variables)
- [Key-Value Storage](#key-value-storage)
- [Path Manipulation](#path-manipulation)

---

## Filesystem Operations

### Read and Write Files
```typescript
import { FileSystem } from "@effect/platform"
import { NodeFileSystem } from "@effect/platform-node"

const fileOps = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  // Read file as string
  const content = yield* fs.readFileString("./config.json")

  // Write string to file
  yield* fs.writeFileString("./output.txt", "Hello, World!")

  // Write with options (append mode)
  yield* fs.writeFile("./log.txt", new TextEncoder().encode("log entry\n"), { flag: "a" })
})

const program = fileOps.pipe(Effect.provide(NodeFileSystem.layer))
```

### List Directory with Stats
```typescript
const listWithStats = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const entries = yield* fs.readDirectory(dir)

    return yield* Effect.all(
      entries.map((name) =>
        Effect.gen(function* () {
          const stat = yield* fs.stat(`${dir}/${name}`)
          return { name, isDirectory: stat.type === "Directory", size: stat.size }
        })
      )
    )
  })
```

### Copy, Move, Remove
```typescript
const fileOperations = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  yield* fs.copy("./source.txt", "./dest.txt")
  yield* fs.rename("./old.txt", "./new.txt")
  yield* fs.remove("./temp.txt")
  yield* fs.remove("./cache", { recursive: true })

  const exists = yield* fs.exists("./config.json")
})
```

---

## Terminal I/O

### Output and Interactive Prompts
```typescript
import { Terminal } from "@effect/platform"
import { NodeTerminal } from "@effect/platform-node"

const interactive = Effect.gen(function* () {
  const terminal = yield* Terminal.Terminal

  // Display output
  yield* terminal.display("Enter your name: ")

  // Read line from stdin
  const name = yield* terminal.readLine

  yield* terminal.display(`Hello, ${name.trim()}!\n`)
})

const program = interactive.pipe(Effect.provide(NodeTerminal.layer))
```

### Colored Output
```typescript
const colors = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`
}

const statusReport = Effect.gen(function* () {
  const terminal = yield* Terminal.Terminal
  yield* terminal.display(colors.green("Success: ") + "Operation completed\n")
  yield* terminal.display(colors.red("Error: ") + "Something went wrong\n")
})
```

---

## Command Execution

### Run Shell Commands
```typescript
import { Command } from "@effect/platform"
import { NodeCommandExecutor } from "@effect/platform-node"

const runCommand = Effect.gen(function* () {
  // Simple command
  const status = yield* Command.string(Command.make("git", "status", "--short"))

  // With working directory
  const files = yield* Command.string(
    Command.make("ls", "-la").pipe(Command.workingDirectory("/tmp"))
  )

  // With environment variables
  const result = yield* Command.string(
    Command.make("node", "script.js").pipe(
      Command.env({ NODE_ENV: "production" })
    )
  )
})

const program = runCommand.pipe(Effect.provide(NodeCommandExecutor.layer))
```

### Piped Commands
```typescript
const grepLogs = Effect.gen(function* () {
  const cat = Command.make("cat", "/var/log/app.log")
  const grep = Command.make("grep", "ERROR")
  return yield* Command.string(Command.pipeTo(cat, grep))
})
```

---

## Environment Variables

### Access Config from Environment
```typescript
import { Config } from "effect"

// Single variables with defaults
const port = Config.number("PORT").pipe(Config.withDefault(3000))
const debug = Config.boolean("DEBUG").pipe(Config.withDefault(false))
const apiKey = Config.redacted("API_KEY")  // For secrets

// Config object
const AppConfig = Config.all({
  host: Config.string("HOST").pipe(Config.withDefault("localhost")),
  port: Config.number("PORT").pipe(Config.withDefault(8080)),
  dbUrl: Config.string("DATABASE_URL"),
  debug: Config.boolean("DEBUG").pipe(Config.withDefault(false))
})

const program = Effect.gen(function* () {
  const config = yield* AppConfig
  yield* Effect.log(`Starting on ${config.host}:${config.port}`)
})
```

### Nested Config
```typescript
// Reads: DB_HOST, DB_PORT, DB_NAME
const DatabaseConfig = Config.nested("DB")(
  Config.all({
    host: Config.string("HOST"),
    port: Config.number("PORT"),
    name: Config.string("NAME")
  })
)
```

---

## Key-Value Storage

### In-Memory and File-Based Storage
```typescript
import { KeyValueStore } from "@effect/platform"
import { NodeFileSystem, NodePath } from "@effect/platform-node"

const cacheExample = Effect.gen(function* () {
  const store = yield* KeyValueStore.KeyValueStore

  yield* store.set("user:123", JSON.stringify({ name: "Alice" }))
  const value = yield* store.get("user:123")  // Option<string>
  const exists = yield* store.has("user:123")
  yield* store.remove("user:123")
  yield* store.clear
})

// In-memory store
const inMemory = cacheExample.pipe(
  Effect.provide(KeyValueStore.layerMemory)
)

// File-system backed store
const persistent = cacheExample.pipe(
  Effect.provide(KeyValueStore.layerFileSystem("./data/kv")),
  Effect.provide(NodeFileSystem.layer),
  Effect.provide(NodePath.layer)
)
```

---

## Path Manipulation

### Path Operations
```typescript
import { Path } from "@effect/platform"
import { NodePath } from "@effect/platform-node"

const pathOps = Effect.gen(function* () {
  const path = yield* Path.Path

  const fullPath = path.join("/home", "user", "file.txt")
  const dir = path.dirname(fullPath)       // /home/user
  const base = path.basename(fullPath)     // file.txt
  const ext = path.extname(fullPath)       // .txt
  const absolute = path.resolve("./rel")   // absolute path
  const normalized = path.normalize("/foo/bar/../baz")  // /foo/baz
})

const program = pathOps.pipe(Effect.provide(NodePath.layer))
```

### Parse and Format Paths
```typescript
const pathParsing = Effect.gen(function* () {
  const path = yield* Path.Path

  // Parse into components
  const parsed = path.parse("/home/user/file.txt")
  // { root: "/", dir: "/home/user", base: "file.txt", ext: ".txt", name: "file" }

  // Format from components
  const formatted = path.format({ dir: "/home/user", name: "doc", ext: ".md" })
  // /home/user/doc.md

  const isAbs = path.isAbsolute("/home")   // true
  const relative = path.relative("/home", "/home/user/docs")  // user/docs
})
```
