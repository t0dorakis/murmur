# Cron Scheduling Support

## Problem

Murmur only supports interval-based scheduling ("30m", "1h"). This works for periodic checks but feels wrong for time-anchored tasks like a daily briefing at 9am. Intervals drift after restarts and can't express "weekdays at 8am" or "first of the month."

## Solution

Add cron expression support alongside intervals using Effect's `Cron` module. Each workspace picks one scheduling mode: interval or cron.

## Config schema

```typescript
type WorkspaceConfig = {
  path: string;
  interval?: string;   // "30m", "1h", "1d" — existing format
  cron?: string;        // "0 9 * * *" — standard 5-field cron
  tz?: string;          // "Europe/Berlin" — timezone for cron (defaults to local)
  maxTurns?: number;
  lastRun: string | null;
};
```

Exactly one of `interval` or `cron` must be set. The `tz` field is only valid with `cron`.

Example config:
```json
{
  "workspaces": [
    {
      "path": "/Users/theo/repos/my-project",
      "interval": "30m",
      "lastRun": "2026-02-04T10:00:00Z"
    },
    {
      "path": "/Users/theo/automations/briefing",
      "cron": "0 9 * * *",
      "tz": "Europe/Berlin",
      "lastRun": null
    }
  ]
}
```

## Dependency

Adds `effect` as a runtime dependency. Used exclusively for the `Cron` module (`Cron.parse`, `Cron.next`, `Cron.unsafeParse`). No use of Effect's runtime, fibers, or scheduling infrastructure — just the cron parser and next-occurrence calculator.

## Implementation

### 1. types.ts

Make `interval` optional, add `cron` and `tz`:

```typescript
type WorkspaceConfig = {
  path: string;
  interval?: string;
  cron?: string;
  tz?: string;
  maxTurns?: number;
  lastRun: string | null;
};
```

### 2. config.ts — isDue()

Add a cron branch to the existing `isDue` function:

```typescript
import { Cron } from "effect";

export function isDue(ws: WorkspaceConfig): boolean {
  if (ws.cron) return isCronDue(ws);
  if (!ws.interval) return false;
  // existing interval logic unchanged
  if (!ws.lastRun) return true;
  const lastRunTime = new Date(ws.lastRun).getTime();
  if (Number.isNaN(lastRunTime)) return true;
  return Date.now() - lastRunTime >= parseInterval(ws.interval);
}

function isCronDue(ws: WorkspaceConfig): boolean {
  const parsed = Cron.unsafeParse(ws.cron!, ws.tz);
  if (!ws.lastRun) {
    // Never run before — check if we're past the most recent cron tick
    const prev = Cron.prev(parsed);
    return prev <= new Date();
  }
  const nextAfterLastRun = Cron.next(parsed, new Date(ws.lastRun));
  return Date.now() >= nextAfterLastRun.getTime();
}
```

### 3. config.ts — Config validation

When reading config, validate each workspace:
- Has exactly one of `interval` or `cron`
- `cron` parses successfully via `Cron.parse()`
- `tz` is only present when `cron` is set
- Log clear error and skip invalid workspaces

### 4. daemon.ts — buildWorkspaceStatuses()

Compute `nextRunAt` differently for cron workspaces:

```typescript
function computeNextRunAt(ws: WorkspaceConfig): number {
  if (ws.cron) {
    const parsed = Cron.unsafeParse(ws.cron, ws.tz);
    const from = ws.lastRun ? new Date(ws.lastRun) : new Date();
    return Cron.next(parsed, from).getTime();
  }
  const intervalMs = parseInterval(ws.interval!);
  const lastRunAt = ws.lastRun ? new Date(ws.lastRun).getTime() : null;
  return lastRunAt ? lastRunAt + intervalMs : Date.now();
}
```

### 5. WorkspaceStatus type

Add `schedule` display string so TUI can show either "30m" or "0 9 * * *":

```typescript
type WorkspaceStatus = {
  path: string;
  name: string;
  interval: string;    // display string: "30m" or "cron: 0 9 * * *"
  nextRunAt: number;
  lastOutcome: Outcome | null;
  lastRunAt: number | null;
};
```

## What doesn't change

- Daemon loop structure (tick-based polling)
- Heartbeat execution (spawn Claude, stream, classify)
- TUI rendering (already uses `nextRunAt` for countdown)
- Socket IPC protocol
- CLI commands
- Log format

## TUI display

Cron workspaces show the cron expression and next fire time in the workspace bar:

```
 Daily Briefing    cron 0 9 * * *    next at 09:00    ✓ ok yesterday
 Project Health    30m               next in 8m 03s   ✓ ok 21m ago
```

For cron schedules where the next run is far away (>1h), show the absolute time ("next at 09:00") rather than a countdown ("next in 14h 32m").

## Edge cases

- **Laptop sleep**: Works correctly — `Cron.next(lastRun)` computes the absolute next time, and on wake we compare to `Date.now()`. Missed cron ticks fire immediately, same as intervals.
- **Multiple missed ticks**: If the daemon was stopped for days, only one heartbeat fires on restart (same as intervals). The `lastRun` is updated, and `Cron.next` computes the next future occurrence.
- **Invalid cron expressions**: Caught at config load time. Workspace is skipped with a clear error message.
- **No timezone specified**: Uses the system's local timezone (same behavior as system crontab).
