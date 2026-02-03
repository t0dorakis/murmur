# Orchester — Spec

## CLI

```
orchester start              # Start the daemon in background
orchester stop               # Stop the daemon (SIGTERM)
orchester status             # Show daemon PID, uptime, workspace states
orchester beat [path]        # Fire one heartbeat now (path defaults to cwd)
orchester init [path]        # Create HEARTBEAT.md template in workspace
```

Entry point: `src/cli.ts` via `package.json` `"bin": { "orchester": "./src/cli.ts" }`

## Config Format (`~/.orchester/config.json`)

```json
{
  "workspaces": [
    {
      "path": "/Users/theo/repos/my-project",
      "interval": "30m",
      "maxTurns": 3,
      "lastRun": "2026-02-03T10:00:00Z"
    },
    {
      "path": "/Users/theo/repos/another-project",
      "interval": "1h",
      "maxTurns": 5,
      "lastRun": null
    }
  ]
}
```

- `path` — absolute path to workspace (must contain HEARTBEAT.md)
- `interval` — human-readable duration: `"30m"`, `"1h"`, `"15m"` (parsed to ms)
- `maxTurns` — max agent loop iterations per heartbeat (default: `3`). Prevents runaway. Tune up for complex prompts that need more tool calls.
- `lastRun` — ISO timestamp of last heartbeat, or `null` if never run

Users edit this file directly to add/remove workspaces. No `add`/`remove` commands needed.

## Log Format (`~/.orchester/heartbeats.jsonl`)

One JSON object per line, appended after each heartbeat:

```jsonl
{"ts":"2026-02-03T10:00:00Z","workspace":"/Users/theo/repos/my-project","outcome":"ok","durationMs":8200}
{"ts":"2026-02-03T10:30:12Z","workspace":"/Users/theo/repos/my-project","outcome":"attention","durationMs":14500,"summary":"2 tests failing in auth.test.ts"}
{"ts":"2026-02-03T11:00:05Z","workspace":"/Users/theo/repos/my-project","outcome":"error","durationMs":300,"error":"HEARTBEAT.md not found"}
```

- `outcome` — `"ok"` | `"attention"` | `"error"`
- `summary` — first 200 chars of Claude's response (only when outcome = attention)
- `error` — error message (only when outcome = error)
- `durationMs` — wall-clock time of the claude invocation

## HEARTBEAT.md

The prompt file. Claude reads this on every heartbeat. It's just markdown — write whatever you want Claude to do. Template created by `orchester init`:

```markdown
# Heartbeat

What to do on each heartbeat. If nothing needs attention, respond with
exactly `HEARTBEAT_OK`. Otherwise, start with `ATTENTION:` and a brief summary.

## Do this

- Check for new GitHub issues on my-org/my-repo using `gh`
- For any untagged issues, add a triage label based on the content
- If there are urgent issues (security, data loss, outage), tell me
```

The template is a starting point. Real prompts will vary widely:

**Email monitoring:**
```markdown
Check my Gmail via MCP for anything urgent in the last hour.
Urgent = from my boss, contains "production", or marked high priority.
If nothing urgent, respond HEARTBEAT_OK.
```

**Code project health:**
```markdown
Run `bun test` and check `git status`.
If tests pass and no uncommitted work, respond HEARTBEAT_OK.
Otherwise tell me what's wrong.
```

**Deploy verification:**
```markdown
Curl https://staging.example.com/health and verify it returns 200.
Check the last 3 deploys via `gh run list`.
If anything looks off, tell me. Otherwise HEARTBEAT_OK.
```

## Prompt Construction

The prompt sent to Claude wraps HEARTBEAT.md contents:

```
You are a heartbeat agent. Follow the instructions below.

WORKSPACE: {path}
TIME: {iso timestamp}

---
{contents of HEARTBEAT.md}
---

Rules:
- Do what the instructions above ask.
- If there is nothing to report: respond with exactly HEARTBEAT_OK (nothing else).
- If something needs human attention: respond with ATTENTION: followed by a concise summary.
- Be brief.
```

## Outcome Classification

```
exit code != 0                           --> error
stdout includes HEARTBEAT_OK             --> ok (suppressed)
otherwise                                --> attention
```

## Claude CLI Invocation

```typescript
const proc = Bun.spawn([
  "claude",
  "--print",
  "--dangerously-skip-permissions",
  "--max-turns", String(ws.maxTurns ?? 3),
], {
  cwd: ws.path,
  stdin: new Blob([prompt]),
  stdout: "pipe",
  stderr: "pipe",
  timeout: 300_000, // 5 minutes — Bun.spawn kills with SIGTERM on expiry
});
```

- `--print` — non-interactive, output only
- `--dangerously-skip-permissions` — no interactive permission prompts (consider `--allowedTools` for tighter scoping)
- `--max-turns` — read from workspace config, defaults to `3`. Caps agent loop iterations to prevent runaway.
- `stdin: new Blob([prompt])` — prompt piped in (avoids shell escaping and arg length limits)
- `cwd` — workspace directory so Claude has file access
- `timeout` — built-in Bun.spawn timeout in ms, kills the process with SIGTERM on expiry

## Types

```typescript
type WorkspaceConfig = {
  path: string;
  interval: string;
  maxTurns?: number; // default: 3
  lastRun: string | null;
};

type Config = {
  workspaces: WorkspaceConfig[];
};

type Outcome = "ok" | "attention" | "error";

type LogEntry = {
  ts: string;
  workspace: string;
  outcome: Outcome;
  durationMs: number;
  summary?: string;
  error?: string;
};
```

## Module Responsibilities

### `src/types.ts`
Shared type definitions exported for all modules.

### `src/config.ts`
- `readConfig(): Config` — read and parse `~/.orchester/config.json`
- `writeConfig(config: Config)` — atomic write (write temp file, rename)
- `parseInterval(s: string): number` — `"30m"` --> `1800000`, `"1h"` --> `3600000`
- `isDue(ws: WorkspaceConfig): boolean` — `lastRun + interval < now`
- `ensureDataDir()` — create `~/.orchester/` if missing

### `src/heartbeat.ts`
- `runHeartbeat(ws: WorkspaceConfig): Promise<LogEntry>` — full cycle: build prompt, spawn, classify, return
- `buildPrompt(ws: WorkspaceConfig): Promise<string>` — read HEARTBEAT.md, wrap in template
- `classify(stdout: string, exitCode: number): Outcome` — determine ok/attention/error

### `src/log.ts`
- `appendLog(entry: LogEntry)` — append JSON line to `~/.orchester/heartbeats.jsonl` (uses `appendFileSync` from `node:fs`)

### `src/daemon.ts`
- Main loop: read config, check due workspaces, run heartbeats, update lastRun, sleep 10s
- Signal handlers: SIGTERM/SIGINT --> clean up PID file, exit

### `src/cli.ts`
- Parse `process.argv[2]` as command name
- `start`: check PID liveness, spawn daemon detached
- `stop`: read PID, send SIGTERM
- `status`: read config + check PID, print workspace states
- `beat`: run one heartbeat for given path, print result
- `init`: write HEARTBEAT.md template to workspace

## Implementation Order

1. `src/types.ts` + `src/config.ts` — foundation
2. `src/heartbeat.ts` — core logic (testable via `orchester beat`)
3. `src/log.ts` — output
4. `src/daemon.ts` — the loop
5. `src/cli.ts` — tie it together
6. Tests for classify, config parsing, interval parsing
7. `package.json` bin field + `bun link`

## Verification Plan

1. `bun test` — unit tests pass
2. `orchester init .` — creates HEARTBEAT.md
3. `orchester beat .` — fires one heartbeat, prints result, appends to JSONL
4. `orchester start` --> wait --> check `~/.orchester/heartbeats.jsonl` for entries
5. Edit HEARTBEAT.md to include a failing check --> verify attention outcome logged
6. `orchester status` — shows daemon running, workspace states
7. `orchester stop` — clean shutdown
