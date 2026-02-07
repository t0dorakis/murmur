# System Architecture: Murmur TUI

**Document Version:** 1.0
**Date:** 2026-02-03
**Status:** Draft

---

## 1. System Overview

### Purpose

Add a persistent terminal UI to the murmur daemon so users can observe heartbeat activity in real-time: countdowns to next execution, streaming Claude output, and classified results. The TUI runs as the default foreground mode, with the current silent background mode preserved via `--detach`.

### Scope

**In Scope:**

- Foreground TUI renderer attached to the daemon loop
- Unix socket event bus for daemon-to-TUI communication
- `murmur watch` command to attach to a running background daemon
- `murmur start --detach` flag for headless background mode
- `Ctrl+D` detach (daemon continues, TUI exits)
- Live streaming of Claude stdout during heartbeat execution

**Out of Scope:**

- Interactive controls beyond q/Ctrl+C/Ctrl+D
- Scrollback buffer or mouse support
- Notification system (desktop notifications, webhooks)
- Multi-column or panel-based layouts
- Historical log viewing within the TUI

### Architectural Drivers

1. **Live streaming** — Claude output must appear character-by-character during execution, not buffered until completion. This fundamentally changes how `runHeartbeat` captures stdout.
2. **Foreground/background duality** — The same daemon loop must run with or without a TUI attached, and support attaching/detaching at runtime.

---

## 2. Architecture Pattern

### Selected Pattern

**Event-driven with Unix socket IPC**

### Pattern Justification

**Why this pattern:**

- The daemon already has a main loop producing events (heartbeat start, output, completion). Adding an event bus formalizes this without restructuring the loop.
- Unix sockets give `murmur watch` the same event stream that the in-process TUI consumes — one renderer, two connection modes.
- Event-driven decouples the daemon logic from rendering. The daemon never imports TUI code.

**Alternatives considered:**

- **Shared log file tailing:** Rejected because it can't stream partial stdout in real-time. JSONL entries are written after completion.
- **Embedded TUI (no IPC):** Rejected because it makes `murmur watch` impossible. The TUI would only work in foreground mode.
- **HTTP/WebSocket server:** Over-engineered for local single-user IPC. Unix socket is simpler and doesn't need a port.

---

## 3. Component Design

### Component Overview

```
┌──────────────────────────────────────────────────────────┐
│                         CLI (cli.ts)                      │
│   start / start --detach / stop / status / watch / beat   │
└──────────┬──────────────────────────────┬────────────────┘
           │                              │
           │ spawns                       │ connects
           ▼                              ▼
┌─────────────────────┐        ┌─────────────────────┐
│   Daemon (daemon.ts)│        │  TUI Renderer       │
│                     │        │  (tui.ts)            │
│  ┌───────────────┐  │        │                      │
│  │  Main Loop    │  │        │  ┌────────────────┐  │
│  │  (tick/check) │  │        │  │ Workspace Bar  │  │
│  └───────┬───────┘  │        │  ├────────────────┤  │
│          │          │        │  │ Activity Feed  │  │
│  ┌───────▼───────┐  │        │  └────────────────┘  │
│  │  Heartbeat    │──┼─emit──▶│                      │
│  │  Engine       │  │        │  Reads events from:  │
│  └───────────────┘  │        │  - in-process (fg)   │
│          │          │        │  - unix socket (watch)│
│  ┌───────▼───────┐  │        └─────────────────────┘
│  │  Event Bus    │  │
│  │  (events.ts)  │  │
│  └───────┬───────┘  │
│          │          │
│  ┌───────▼───────┐  │
│  │  Socket Server│  │
│  │  (socket.ts)  │  │
│  └───────────────┘  │
└─────────────────────┘
```

### Component: Event Bus (`src/events.ts`)

**Responsibility:** Typed event emitter that the daemon loop publishes to and the TUI subscribes to.

**Events Emitted:**

```typescript
type DaemonEvent =
  | { type: "tick"; workspaces: WorkspaceStatus[] }
  | { type: "heartbeat:start"; workspace: string; promptPreview: string }
  | { type: "heartbeat:stdout"; workspace: string; chunk: string }
  | { type: "heartbeat:done"; workspace: string; entry: LogEntry }
  | { type: "daemon:ready"; pid: number; workspaceCount: number }
  | { type: "daemon:shutdown" };

type WorkspaceStatus = {
  path: string;
  name: string; // first # heading from HEARTBEAT.md
  interval: string;
  nextRunAt: number; // epoch ms
  lastOutcome: Outcome | null;
  lastRunAt: number | null;
};
```

**Interface:**

- `emit(event: DaemonEvent)` — Publish event to all subscribers
- `subscribe(callback: (event: DaemonEvent) => void)` — Register listener
- `unsubscribe(callback)` — Remove listener

**Implementation:** Simple synchronous callback list. No external EventEmitter dependency needed — a plain array of callbacks.

---

### Component: Socket Server (`src/socket.ts`)

**Responsibility:** Expose daemon events over a Unix domain socket so external processes (`murmur watch`) can subscribe.

**Interface:**

- `startSocketServer(bus: EventBus): Server` — Bind to `~/.murmur/murmur.sock`, listen for connections
- `stopSocketServer(server: Server)` — Close socket, clean up file

**Protocol:** Newline-delimited JSON (NDJSON). Each event is `JSON.stringify(event) + "\n"` written to connected clients. Read direction is unused (clients are passive consumers).

**Connection lifecycle:**

1. Client connects to `murmur.sock`
2. Server sends a `daemon:ready` event with current state as the first message
3. Server forwards all subsequent `DaemonEvent`s as NDJSON lines
4. On client disconnect, server removes from subscriber list
5. On daemon shutdown, server sends `daemon:shutdown` and closes

**Cleanup:** Socket file is deleted on daemon shutdown (in the `cleanup()` function alongside PID file removal). Stale socket files from crashed daemons are unlinked before binding.

---

### Component: TUI Renderer (`src/tui.ts`)

**Responsibility:** Renders the terminal UI by consuming `DaemonEvent`s and writing ANSI escape sequences to stdout.

**Interface:**

- `createTui(eventSource: EventSource): Tui` — Initialize renderer
- `tui.start()` — Enter alternate screen, hide cursor, begin render loop
- `tui.stop()` — Restore screen, show cursor, clean up

**`EventSource`** is an abstraction over both modes:

```typescript
type EventSource = {
  subscribe(callback: (event: DaemonEvent) => void): void;
  unsubscribe(callback: (event: DaemonEvent) => void): void;
};
```

In foreground mode, this is the in-process EventBus. In `murmur watch`, this is a socket client that parses NDJSON lines and invokes the callback.

**Rendering approach:**

Raw ANSI escape sequences. No framework. The renderer maintains an internal state model and redraws on every event:

- **Workspace bar:** Fixed at top. Full redraw on `tick` events (once per second is fine). Uses cursor positioning to overwrite in place.
- **Activity feed:** Appends below the bar. `heartbeat:start` adds a new entry. `heartbeat:stdout` appends chunks to the current entry (streaming). `heartbeat:done` finalizes the entry (collapses if ok, colorizes outcome).

**State model:**

```typescript
type TuiState = {
  pid: number;
  workspaces: WorkspaceStatus[];
  feed: FeedEntry[];
  activeBeat: { workspace: string; output: string; elapsed: number } | null;
};

type FeedEntry = {
  workspace: string;
  name: string;
  promptPreview: string;
  outcome: Outcome;
  durationMs: number;
  output: string; // full Claude response (for attention/error)
};
```

**Screen regions:**

- Lines 1 to `N+2` (where N = workspace count): workspace bar (fixed, redrawn in place)
- Line `N+3`: thin separator (`─` repeated to terminal width, dim)
- Lines `N+4` onward: activity feed (append-only, scrolls naturally)

**Countdown rendering:** A 1-second `setInterval` recalculates `nextRunAt - Date.now()` for each workspace and redraws the workspace bar. This is the only timer-driven render; everything else is event-driven.

---

### Component: Socket Client (`src/socket-client.ts`)

**Responsibility:** Connect to a running daemon's Unix socket and provide the `EventSource` interface for the TUI.

**Interface:**

- `connectToSocket(socketPath: string): Promise<EventSource>` — Connect, return event source
- Throws if socket doesn't exist or connection refused (daemon not running)

**Implementation:** Uses Bun's Unix socket support. Reads NDJSON lines from the socket, parses each as `DaemonEvent`, invokes subscriber callbacks.

---

### Component: Modified CLI (`src/cli.ts`)

**Changes to existing commands:**

| Command          | Current                          | New                                             |
| ---------------- | -------------------------------- | ----------------------------------------------- |
| `start`          | Spawn detached daemon, print PID | Import daemon loop + TUI, run in foreground     |
| `start --detach` | (n/a)                            | Old `start` behavior: spawn detached, print PID |
| `watch`          | (n/a)                            | Connect to socket, launch TUI renderer          |
| `stop`           | SIGTERM by PID                   | Unchanged                                       |
| `status`         | Print text                       | Unchanged                                       |
| `beat`           | Run one heartbeat                | Unchanged                                       |
| `init`           | Create HEARTBEAT.md              | Unchanged                                       |

**Foreground `start` flow:**

1. Check if already running (PID check) — exit if so
2. Write PID file (own process)
3. Start socket server
4. Start event bus
5. Start TUI renderer (subscribes to bus)
6. Enter daemon main loop (publishes to bus)
7. On `q`/`Ctrl+C`: cleanup (stop loop, close socket, delete PID, restore terminal)
8. On `Ctrl+D`: stop TUI, fork daemon to background, print detach message, exit

**`watch` flow:**

1. Check socket exists — exit with message if not
2. Connect to socket → get EventSource
3. Start TUI renderer (subscribes to socket EventSource)
4. On `q`/`Ctrl+C`: disconnect, restore terminal, exit (daemon keeps running)

---

### Component: Modified Heartbeat Engine (`src/heartbeat.ts`)

**Changes:** `runHeartbeat` must stream stdout incrementally instead of buffering it.

**Current:** `await new Response(proc.stdout).text()` — waits for full output.

**New:** Read from `proc.stdout` as a `ReadableStream`, emit `heartbeat:stdout` events per chunk:

```typescript
export async function runHeartbeat(
  ws: WorkspaceConfig,
  emit?: (event: DaemonEvent) => void,
): Promise<LogEntry> {
  // ... build prompt, spawn process (unchanged) ...

  emit?.({ type: "heartbeat:start", workspace: ws.path, promptPreview });

  let stdout = "";
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    stdout += chunk;
    emit?.({ type: "heartbeat:stdout", workspace: ws.path, chunk });
  }

  const exitCode = await proc.exited;
  // ... classify, build entry (unchanged) ...

  emit?.({ type: "heartbeat:done", workspace: ws.path, entry });
  return entry;
}
```

The `emit` parameter is optional. When running in `murmur beat` (one-shot), no emitter is passed and behavior is unchanged. When running from the daemon loop, the bus's `emit` is passed through.

---

## 4. Data Model

### New Types (`src/types.ts` additions)

```typescript
// Event bus types
export type DaemonEvent =
  | { type: "tick"; workspaces: WorkspaceStatus[] }
  | { type: "heartbeat:start"; workspace: string; promptPreview: string }
  | { type: "heartbeat:stdout"; workspace: string; chunk: string }
  | { type: "heartbeat:done"; workspace: string; entry: LogEntry }
  | { type: "daemon:ready"; pid: number; workspaceCount: number }
  | { type: "daemon:shutdown" };

export type WorkspaceStatus = {
  path: string;
  name: string;
  interval: string;
  nextRunAt: number;
  lastOutcome: Outcome | null;
  lastRunAt: number | null;
};
```

### State Files

| File                         | Format      | Change    |
| ---------------------------- | ----------- | --------- |
| `~/.murmur/config.json`      | JSON        | Unchanged |
| `~/.murmur/heartbeats.jsonl` | JSONL       | Unchanged |
| `~/.murmur/murmur.pid`       | Plain text  | Unchanged |
| `~/.murmur/murmur.sock`      | Unix socket | **New**   |

---

## 5. IPC Protocol Specification

### Wire Format

NDJSON (newline-delimited JSON) over Unix domain socket.

```
{"type":"daemon:ready","pid":37037,"workspaceCount":3}\n
{"type":"tick","workspaces":[...]}\n
{"type":"heartbeat:start","workspace":"/path","promptPreview":"Check email..."}\n
{"type":"heartbeat:stdout","workspace":"/path","chunk":"Checking inbox..."}\n
{"type":"heartbeat:stdout","workspace":"/path","chunk":" 3 new messages."}\n
{"type":"heartbeat:done","workspace":"/path","entry":{...}}\n
```

### Connection Semantics

- **Direction:** Server (daemon) → Client (watch). Unidirectional.
- **First message:** Always `daemon:ready` with current state.
- **Tick events:** Sent every second (driven by TUI countdown timer in daemon process). Contain full workspace status array so the client can render countdowns.
- **Backpressure:** If a client can't keep up, the daemon does not block. Slow clients miss events (acceptable — the next `tick` event provides full state recovery).
- **Reconnection:** The client does not auto-reconnect. If the socket closes, `murmur watch` exits with "Daemon stopped."

---

## 6. Non-Functional Requirements Mapping

| ID    | Category         | Requirement                                                        | Architectural Decision                                            |
| ----- | ---------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| NFR-1 | Latency          | Streaming output appears within 1 tick (10s max, typically <100ms) | ReadableStream chunked reads, synchronous event dispatch          |
| NFR-2 | Resource usage   | TUI adds negligible CPU/memory overhead                            | No framework, raw ANSI, no DOM diffing, no virtual terminal       |
| NFR-3 | Compatibility    | Works on macOS and Linux terminals                                 | ANSI escape codes (universally supported), no terminfo dependency |
| NFR-4 | Resilience       | Daemon crash doesn't leave orphaned socket file                    | Cleanup on SIGTERM/SIGINT, stale socket detection on startup      |
| NFR-5 | Backwards compat | `--detach` preserves current headless behavior                     | Detach flag bypasses all TUI/socket code                          |
| NFR-6 | No new packages  | Raw ANSI, Bun built-in unix socket, plain TypeScript               |

---

## 7. Technology Stack

### Runtime

**Bun** (existing) — No change.

### TUI Rendering

**Raw ANSI escape sequences** — No framework.

Rationale:

- The TUI is simple: two regions, no interactive widgets, no forms
- ANSI codes for: cursor positioning, color (SGR), alternate screen, clear line
- Total rendering code estimated at ~200 lines

Alternatives considered:

- **Ink (React for terminals):** Adds React dependency, over-engineered for a static layout
- **blessed/blessed-contrib:** Abandoned, huge dependency tree
- **@clack/core:** Designed for prompts, not persistent UIs

### IPC

**Unix domain socket** (Bun built-in `Bun.listen` / `Bun.connect` with `unix` option)

Rationale:

- Zero network overhead (kernel-level IPC)
- No port conflicts
- Natural file-based lifecycle (exists when daemon is running)
- Bun supports Unix sockets natively

### Key ANSI Sequences Used

| Sequence                      | Purpose                            |
| ----------------------------- | ---------------------------------- |
| `\x1b[?1049h` / `\x1b[?1049l` | Enter/exit alternate screen buffer |
| `\x1b[?25l` / `\x1b[?25h`     | Hide/show cursor                   |
| `\x1b[H`                      | Move cursor to top-left            |
| `\x1b[{row};{col}H`           | Move cursor to position            |
| `\x1b[2K`                     | Clear entire line                  |
| `\x1b[J`                      | Clear from cursor to end of screen |
| `\x1b[1m` / `\x1b[2m`         | Bold / dim                         |
| `\x1b[32m` `[33m` `[31m`      | Green / yellow / red               |
| `\x1b[0m`                     | Reset attributes                   |

---

## 8. Trade-off Analysis

### Trade-off 1: Raw ANSI vs. TUI Framework

**Decision:** Raw ANSI escape codes

**Options Considered:**

1. **Raw ANSI** — Direct escape sequences, full control, zero deps
2. **Ink (React for CLI)** — Declarative, component model, heavy dependency

**Selection Rationale:**

- The UI has two static regions with no interactive elements
- A framework's reconciliation/diffing overhead is wasted here
- Raw ANSI is ~200 lines of code for this layout

**Trade-offs Accepted:**

- **Benefit:** No dependencies, fast rendering, full control
- **Cost:** Manual cursor management, no layout engine
- **Mitigation:** Extract ANSI helpers into a small utility module

---

### Trade-off 2: Unix Socket vs. Log File Tailing

**Decision:** Unix socket

**Options Considered:**

1. **Unix socket** — Structured events, real-time, bidirectional-capable
2. **Log file tailing** — Simple, uses existing JSONL log

**Selection Rationale:**

- Log file only gets entries after heartbeat completion — can't stream partial output
- Socket enables character-by-character streaming
- Socket provides typed events vs. parsing log lines

**Trade-offs Accepted:**

- **Benefit:** Real-time streaming, structured events, clean lifecycle
- **Cost:** More code than `tail -f`, need to handle socket cleanup
- **Mitigation:** Socket file cleaned up in existing `cleanup()` function

---

### Trade-off 3: Alternate Screen vs. Inline Rendering

**Decision:** Alternate screen buffer

**Options Considered:**

1. **Alternate screen** — TUI takes over terminal, restores on exit
2. **Inline** — Output mixed with existing terminal content

**Selection Rationale:**

- Alternate screen gives a clean canvas and restores the user's terminal on exit
- Fixed workspace bar requires cursor positioning, which conflicts with inline scrollback
- Standard behavior for persistent TUIs (htop, vim, less)

**Trade-offs Accepted:**

- **Benefit:** Clean rendering, no terminal pollution, proper restore on exit
- **Cost:** Can't see TUI output after exiting (it's gone)
- **Mitigation:** All heartbeat results are still logged to `heartbeats.jsonl`

---

## 9. File Structure

### New Files

```
src/
  events.ts          Event bus (emit/subscribe)
  socket.ts          Unix socket server (daemon side)
  socket-client.ts   Unix socket client (watch side)
  tui.ts             Terminal UI renderer
  ansi.ts            ANSI escape code helpers
```

### Modified Files

```
src/
  cli.ts             Add --detach flag, watch command, foreground mode
  daemon.ts          Integrate event bus, emit events from loop
  heartbeat.ts       Stream stdout via ReadableStream, accept emit callback
  types.ts           Add DaemonEvent, WorkspaceStatus types
```

### Unchanged Files

```
src/
  config.ts          No changes needed
  log.ts             No changes needed
```

---

## 10. Implementation Sequence

### Phase 1: Event infrastructure

- Add types to `types.ts`
- Implement `events.ts` (event bus)
- Modify `heartbeat.ts` to stream stdout and accept optional emitter
- Modify `daemon.ts` to create event bus and pass emitter to heartbeat engine
- Add `tick` event emission to daemon loop

### Phase 2: TUI renderer

- Implement `ansi.ts` (escape code helpers)
- Implement `tui.ts` (workspace bar + activity feed rendering)
- Wire TUI into `cli.ts` for foreground `start` mode
- Add keyboard handling (q, Ctrl+C, Ctrl+D)

### Phase 3: Socket IPC

- Implement `socket.ts` (server)
- Implement `socket-client.ts` (client)
- Start socket server in daemon (both foreground and detached modes)
- Add `murmur watch` command to `cli.ts`

### Phase 4: Detach/attach

- Implement `Ctrl+D` detach behavior (fork to background, close TUI)
- Implement `--detach` flag (skip TUI entirely)
- Handle stale socket cleanup on startup

---

## Appendix

### Glossary

| Term      | Definition                                                                           |
| --------- | ------------------------------------------------------------------------------------ |
| Tick      | The daemon's wake cycle (default 10s). Config is re-read and workspaces are checked. |
| Heartbeat | A single execution of a workspace's HEARTBEAT.md prompt through Claude.              |
| Workspace | A directory containing a HEARTBEAT.md file, registered in config.json.               |
| Feed      | The scrolling activity log in the bottom half of the TUI.                            |
| Outcome   | Classification of heartbeat result: ok, attention, or error.                         |
| NDJSON    | Newline-delimited JSON. One JSON object per line.                                    |

### References

- Design Document: `docs/plans/2026-02-03-tui-design.md`
- Existing Source: `src/` (6 files, ~450 lines)
