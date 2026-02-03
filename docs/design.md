# Orchester — Design

## System Overview

```
~/.orchester/
  config.json          <-- which prompts to run and how often (you edit this)
  heartbeats.jsonl     <-- append-only run log
  orchester.pid        <-- daemon PID
  orchester.log        <-- daemon debug log

~/automations/email/
  HEARTBEAT.md         <-- "Check my Gmail for anything urgent" (you write this)

~/repos/my-project/
  HEARTBEAT.md         <-- "Run tests, check git status" (you write this)
```

Two state locations: one global (`~/.orchester/`) for daemon state, one per-directory (`HEARTBEAT.md`) for the prompt itself. A directory can be a code project, but it doesn't have to be — it's just where the prompt file lives and where Claude runs.

## Data Flow

```
1. Daemon wakes up (every 10s)
2. Reads ~/.orchester/config.json
3. For each workspace: is it due? (lastRun + interval < now)
4.   Yes --> read HEARTBEAT.md, build prompt
5.        --> spawn `claude -p` with prompt on stdin, cwd set to workspace
6.        --> wait for output (5 min timeout via Bun.spawn timeout option)
7.        --> parse JSON output, classify: ok | attention | error
8.        --> append result to heartbeats.jsonl
9.        --> update lastRun timestamp in config.json
```

## Components (6 files)

```
src/
  cli.ts              # Entry point: parse argv, dispatch command
  daemon.ts           # The loop: wake, check, sleep
  heartbeat.ts        # Spawn claude, capture output, classify result
  config.ts           # Read/write ~/.orchester/config.json
  log.ts              # Append to heartbeats.jsonl
  types.ts            # TypeScript type definitions
```

No subdirectories. No commands/ folder. Each file is small enough to read in one screen.

## Why Plain Files Over SQLite

SQLite adds: schema definition, migrations, WAL mode, connection management, query building, type mapping. For what? Storing a list of directories and an append-only log.

- **Config** --> JSON file. 5 workspaces = 20 lines. Edit it in your editor.
- **Run history** --> JSONL. One line per heartbeat. `grep`, `jq`, `tail -f` all work. No queries needed.
- **State** --> Config file tracks `lastRun` per workspace. Daemon reads it, updates it.

If you outgrow JSONL, you'll know. Until then, it's just files.

## Why a Simple Loop Over a Complex Scheduler

A `Scheduler` class with `activeHeartbeats` maps, `AbortController` pools, and tick timers is solving a problem we don't have. We're running heartbeats every 30 minutes, not processing 10K events/sec.

```typescript
while (running) {
  for (const ws of config.workspaces) {
    if (isDue(ws)) await runHeartbeat(ws);
  }
  await Bun.sleep(10_000);
}
```

Sequential execution. If a heartbeat takes 2 minutes, the next one waits. That's fine — we're running prompts every 30 minutes, not processing 10K events/sec. Simplicity over concurrency.

## Daemon Lifecycle

**Start**: `orchester start`
1. Check if PID file exists and process is alive --> exit with "already running"
2. Spawn detached: `Bun.spawn(["bun", "src/daemon.ts"], { detached: true, stdio: ["ignore", "ignore", "ignore"] })` then `proc.unref()`
3. Daemon writes PID to `~/.orchester/orchester.pid`
4. Print PID and exit

**PID liveness check**: `process.kill(pid, 0)` succeeds if process exists. Guard against PID recycling by verifying the process is actually `bun` (check via `ps -p <pid> -o comm=`).

**Loop** (inside daemon):
1. Read config.json
2. For each workspace where `now - lastRun > interval`: run heartbeat
3. Sleep 10 seconds
4. Repeat

**Stop**: `orchester stop`
1. Read PID from file
2. `process.kill(pid, "SIGTERM")`
3. Daemon catches SIGTERM, cleans up PID file, exits

## File I/O Notes

- **Config writes**: `Bun.write()` is not atomic and has no append mode. Use write-to-temp + `renameSync()` for config updates to avoid corruption on crash.
- **JSONL append**: Use `appendFileSync` from `node:fs` — `Bun.write()` has no append option.

## Edge Cases

- **Claude CLI not installed**: Preflight check before spawning. Log error, skip workspace. Next tick retries.
- **HEARTBEAT.md missing**: Log error, skip. Suggests running `orchester init`.
- **Previous heartbeat still running**: Sequential loop means this can't happen — each prompt completes before the next starts.
- **Laptop sleep/wake**: Tick loop checks absolute timestamps (`lastRun + interval < now`), not relative timers. All overdue workspaces fire on the first tick after wake. Timers freeze during sleep but resume on wake — no issue since we re-check absolute time each tick.
- **App Nap (macOS)**: macOS may throttle the background daemon. Mitigate with `defaults write com.apple.Terminal NSAppSleepDisabled -bool YES` if tick intervals become unreliable.
- **Long Claude output**: Full output stored in JSONL.
- **Config edited while daemon runs**: Config is re-read on every tick (every 10s). Changes take effect within seconds.
- **Runaway agent loops**: `--max-turns` is configurable per workspace (default: 3) to cap how many tool-call iterations Claude can do per heartbeat.
