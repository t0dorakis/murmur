# Rename: orchester -> murmur

## Decision

Rename the project from **orchester** to **murmur** before publishing.

**Why murmur:** A heart murmur is an unusual sound the heart makes — it only "speaks up" when something is off. This maps directly to the tool's core design principle: run silently on a heartbeat schedule, only surface output when something needs attention.

**What stays:** The internal "heartbeat" terminology is kept (HEARTBEAT.md, heartbeats.jsonl, `beat` command). Heartbeat is an established concept from the clawdbot ecosystem and describes the scheduling mechanic well. "Murmur" is the product name; "heartbeat" is the domain term.

## Scope of Changes

### package.json
- `"name": "orchester"` -> `"name": "murmur"`
- `"bin": { "orchester": ... }` -> `"bin": { "murmur": ... }`

### Source files

**src/config.ts**
- `~/.orchester` -> `~/.murmur`

**src/cli.ts**
- `orchester.pid` -> `murmur.pid`
- Usage strings and help text: `orchester` -> `murmur`

**src/daemon.ts**
- `orchester.pid` -> `murmur.pid`

### Tests

**test/e2e.test.ts**
- Helper function name: `orchester()` -> `murmur()`
- Temp dir prefix: `orchester-e2e-` -> `murmur-e2e-`
- PID file references: `orchester.pid` -> `murmur.pid`
- Test descriptions

### Documentation

**README.md** — All CLI examples and path references.

**docs/design.md** — Architecture doc references.

**docs/spec.md** — Full spec references.

**docs/vision.md** — Vision doc references.

### Generated files
- `bun.lock` will update automatically after `bun install`

### NOT changed
- `HEARTBEAT.md` template and filename (keeping heartbeat terminology)
- `heartbeats.jsonl` log filename
- Internal heartbeat/beat concepts and variable names
- The `beat` subcommand
