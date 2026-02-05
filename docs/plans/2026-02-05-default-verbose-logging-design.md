# Default Verbose Logging Design

**Date:** 2026-02-05
**Status:** Draft
**Branch:** feature/verbose-beat-logs

## Summary

Make tool call visibility the default behavior for `murmur beat` and the TUI daemon. Simplify the stream parser using Effect Stream. Improve display formatting with minimal icons.

## Goals

1. **Default verbose** - Tool calls visible by default in both CLI and TUI
2. **Simplify parsing** - Replace 276-line manual parser with Effect Stream (~60 lines)
3. **Nicer formatting** - Inline tool display with Unicode icons

## Non-Goals

- Refactoring the pub/sub event system (separate ticket)
- Adding Effect to other parts of the codebase (future work)

## Design

### Effect Stream Parser

Replace manual line buffering and state tracking with Effect Stream:

```typescript
import { Stream } from "effect"

const parseClaudeStream = (readable: ReadableStream<Uint8Array>) =>
  Stream.fromReadableStream(() => readable, (e) => new ParseError(e))
    .pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.filter((line) => line.trim().length > 0),
      Stream.map((line) => JSON.parse(line) as StreamMessage),
      Stream.mapAccum(initialState, processMessage),
      Stream.flatMap(Stream.fromIterable),
    )
```

The `processMessage` accumulator handles matching `tool_use` with `tool_result` (same logic, cleaner structure).

### Tool Call Display Format

Inline display with icons:

```
◇ Read src/config.ts                 # Tool started (dim)
◆ Read src/config.ts                 # Tool completed (normal)
⟳ Bash npm test...                   # Tool running (dim)
✗ Edit failed: file not found        # Tool error (red)
```

**Formatting rules:**
- Tool name shown as-is (Read, Edit, Bash, Grep, etc.)
- First argument shown as the "target" (file path, command, pattern)
- Long paths truncated: `…deep/path/file.ts`
- Duration shown if > 1s: `◆ Bash npm test (3.2s)`

### TUI Daemon Integration

**Active beat section** (during heartbeat):
```
── myproject ─────────────────────────────
◆ Read package.json
◆ Glob **/*.ts
⟳ Edit src/cli.ts...
```

**Feed history** (completed beats):
```
✓ myproject  2m ago  4 tools  $0.02
● other-repo  15m ago  12 tools  [attention]
```

Feed shows tool count summary. Full details in `~/.murmur/last-beat-{workspace}.json`.

### CLI Flag Changes

**Remove:** `--verbose` / `-V`
**Add:** `--quiet` / `-q` to suppress tool calls

| Command | Tools shown | Stdout | Summary |
|---------|-------------|--------|---------|
| `murmur beat <path>` | ✓ | ✓ | ✓ |
| `murmur beat <path> -q` | ✗ | ✓ | ✓ |
| `murmur daemon` | ✓ | ✓ | in feed |
| `murmur daemon -q` | ✗ | ✓ | in feed |

Quiet mode still parses stream (for logging), just suppresses tool display.

## Implementation

### Files to Modify

| File | Changes |
|------|---------|
| `src/stream-parser.ts` | Rewrite with Effect Stream |
| `src/cli.ts` | Replace `--verbose` with `--quiet`, update display |
| `src/heartbeat.ts` | Always use stream-json, pass quiet flag |
| `src/tui.ts` | Handle `heartbeat:tool-call`, render tool list |
| `src/types.ts` | Add `tools` to `ActiveBeat` |
| `src/ansi.ts` | Add tool icon constants |
| `tests/stream-parser.test.ts` | Update for Effect-based API |

### Estimated Impact

- ~200 lines removed (old parser complexity)
- ~150 lines added (Effect stream + TUI tool display)
- Net: ~50 lines smaller

## Testing

- Update existing stream parser tests for new Effect API
- E2E tests already exercise verbose output (reuse for default behavior)
- Manual testing of TUI tool display
