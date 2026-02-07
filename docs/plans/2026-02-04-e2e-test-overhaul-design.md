# E2E Test Overhaul & Debug Logging

## Problem

E2E tests have three issues:

1. Daemon lifecycle tests fail — `start` is called without `--detach`, so the foreground process hangs
2. No meaningful output on failure — murmur's stdout/stderr and internal state are invisible
3. Tests run against `bun src/cli.ts` instead of the compiled binary

Additionally, `jokes.txt` accumulates content across runs, slowing Claude's response time.

## Design

### Test binary

Tests run against the compiled `./murmur` binary (built with `bun build --compile src/cli.ts --outfile murmur`). The test helper uses the binary directly:

```ts
const MURMUR_BIN = join(REPO_DIR, "murmur");

async function murmur(...args: string[]) {
  const proc = Bun.spawn([MURMUR_BIN, "--data-dir", testDataDir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}
```

A `beforeAll` guard checks the binary exists and fails with a clear message if not.

### Test hygiene

`beforeEach` resets `example/jokes.txt` to a single known line. This keeps Claude's context small and response time under 20s.

### Daemon tests fix

Daemon lifecycle tests pass `--detach` so the process backgrounds and exits cleanly. The 50s sleep drops to 20s. Timeouts drop from 120s to 60s.

### Log surfacing

The `murmur()` helper prints stdout/stderr on non-zero exit:

```ts
if (exitCode !== 0) {
  console.log(`[murmur ${args.join(" ")}] stdout: ${stdout}`);
  console.log(`[murmur ${args.join(" ")}] stderr: ${stderr}`);
}
```

Tests always pass `--debug`. On failure, the debug log is dumped to console.

## `--debug` flag

### CLI parsing

New global flag `--debug` parsed in `parseGlobalArgs()` alongside `--data-dir`, `--tick`, etc.

### Debug logger (`src/debug.ts`)

Exposes a `debug(message: string)` function. When `--debug` is active, appends timestamped lines to `<data-dir>/debug.log`. When inactive, it's a no-op.

Example output:

```
[2026-02-04T10:00:00.123Z] Config loaded: 1 workspace(s)
[2026-02-04T10:00:00.124Z] Heartbeat: /Users/theo/repos/orchester/example
[2026-02-04T10:00:00.125Z] HEARTBEAT.md: 12 lines
[2026-02-04T10:00:00.126Z] Spawning: claude -p "..." --cwd /Users/theo/repos/orchester/example
[2026-02-04T10:00:14.500Z] Claude stdout: HEARTBEAT_OK
[2026-02-04T10:00:14.501Z] Claude stderr: (empty)
[2026-02-04T10:00:14.502Z] Outcome: ok (exit=0, contains HEARTBEAT_OK)
[2026-02-04T10:00:14.503Z] Duration: 14377ms
```

### Instrumentation points

- **config.ts** — workspace resolution, interval/cron parsing
- **heartbeat.ts** — HEARTBEAT.md content, Claude spawn command, raw stdout/stderr, outcome classification, duration
- **daemon.ts** — tick fired, isDue check per workspace, config reloads
