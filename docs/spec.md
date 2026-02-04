# Murmur — Spec

## CLI

```
murmur start              # Start the daemon in background
murmur stop               # Stop the daemon (SIGTERM)
murmur status             # Show daemon PID, uptime, workspace states
murmur beat [path]        # Fire one heartbeat now (path defaults to cwd)
murmur beat --verbose [path]  # Fire heartbeat with full tool call visibility
murmur init [path]        # Create HEARTBEAT.md template in workspace
```

Entry point: `src/cli.ts` via `package.json` `"bin": { "murmur": "./src/cli.ts" }`

## Config Format (`~/.murmur/config.json`)

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
      "permissions": {
        "deny": ["Bash(curl *)", "Bash(wget *)"]
      },
      "lastRun": null
    }
  ]
}
```

- `path` — absolute path to workspace (must contain HEARTBEAT.md)
- `interval` — human-readable duration: `"30m"`, `"1h"`, `"15m"` (parsed to ms)
- `maxTurns` — max agent loop iterations per heartbeat (default: `3`). Prevents runaway. Tune up for complex prompts that need more tool calls.
- `permissions` — optional permission overrides (see [Permissions](#permissions) below). Set to `"skip"` to opt out of the deny list entirely.
- `lastRun` — ISO timestamp of last heartbeat, or `null` if never run

Users edit this file directly to add/remove workspaces. No `add`/`remove` commands needed.

## Log Format (`~/.murmur/heartbeats.jsonl`)

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

The prompt file. Claude reads this on every heartbeat. It's just markdown — write whatever you want Claude to do. Template created by `murmur init`:

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
const disallowedTools = buildDisallowedToolsArgs(ws.permissions);
const proc = Bun.spawn([
  "claude",
  "--print",
  "--dangerously-skip-permissions",
  ...disallowedTools,
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
- `--dangerously-skip-permissions` — no interactive permission prompts (required for non-interactive daemon use)
- `--disallowedTools` — blocks catastrophic operations via the default deny list, merged with per-workspace overrides (see [Permissions](#permissions))
- `--max-turns` — read from workspace config, defaults to `3`. Caps agent loop iterations to prevent runaway.
- `--output-format stream-json` — added in verbose mode to capture tool calls and reasoning as NDJSON
- `stdin: new Blob([prompt])` — prompt piped in (avoids shell escaping and arg length limits)
- `cwd` — workspace directory so Claude has file access
- `timeout` — built-in Bun.spawn timeout in ms, kills the process with SIGTERM on expiry

## Types

```typescript
type PermissionsConfig = {
  deny?: string[];       // additional tool patterns to block
};

type PermissionsOption = PermissionsConfig | "skip";

type WorkspaceConfig = {
  path: string;
  interval: string;
  maxTurns?: number;          // default: 3
  permissions?: PermissionsOption;  // "skip" to opt out of deny list
  lastRun: string | null;
};

type Config = {
  workspaces: WorkspaceConfig[];
};

type Outcome = "ok" | "attention" | "error";

type ToolCall = {
  name: string;
  input: Record<string, unknown>;
  output?: string;
  durationMs?: number;
};

type ConversationTurn =
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[] }
  | { role: "result"; text: string; costUsd?: number; durationMs?: number; numTurns?: number };

type LogEntry = {
  ts: string;
  workspace: string;
  outcome: Outcome;
  durationMs: number;
  summary?: string;
  error?: string;
  turns?: ConversationTurn[];  // populated when --verbose
};
```

## Permissions

Heartbeat agents run with `--dangerously-skip-permissions` because daemon execution is non-interactive. To mitigate risk, every heartbeat applies a default deny list via `--disallowedTools` that blocks catastrophic operations.

### Default Deny List

The following tool patterns are always blocked:

| Pattern | Purpose |
|---------|---------|
| `Bash(rm -rf /)` | Filesystem destruction (root) |
| `Bash(rm -rf /*)` | Filesystem destruction (root contents) |
| `Bash(rm -rf ~)` | Home directory destruction |
| `Bash(rm -rf ~/*)` | Home directory contents destruction |
| `Bash(mkfs*)` | Disk formatting |
| `Bash(dd if=* of=/dev/*)` | Raw disk writes |
| `Bash(shred *)` | Secure file deletion |
| `Bash(sudo *)` | Privilege escalation |
| `Bash(shutdown *)` | System shutdown |
| `Bash(reboot*)` | System reboot |
| `Bash(halt*)` | System halt |
| `Bash(poweroff*)` | System power off |

### Per-Workspace Overrides

Workspaces can add extra deny rules via the `permissions.deny` field. These are merged (union) with the defaults:

```json
{
  "path": "/Users/theo/repos/my-project",
  "interval": "30m",
  "permissions": {
    "deny": ["Bash(curl *)", "Bash(wget *)", "Bash(npm publish*)"]
  },
  "lastRun": null
}
```

Workspace deny rules are appended to the default list. Duplicates are ignored. There is no way to remove a default deny rule -- the defaults are always enforced.

### Opting Out

To opt out of the deny list entirely, set `"permissions": "skip"`. This restores the naked `--dangerously-skip-permissions` behavior with no `--disallowedTools` restrictions:

```json
{
  "path": "/Users/theo/repos/trusted-project",
  "interval": "30m",
  "permissions": "skip",
  "lastRun": null
}
```

Use this only for fully trusted workspaces where the heartbeat prompt requires unrestricted tool access.

### Pattern Format

Patterns follow Claude Code's `--disallowedTools` glob syntax:
- `Bash(command*)` -- matches any Bash tool call whose command starts with the given prefix (`*` is a glob wildcard)
- `Edit` -- blocks the Edit tool entirely
- `mcp__servername` -- blocks all tools from an MCP server

## Module Responsibilities

### `src/types.ts`
Shared type definitions exported for all modules.

### `src/permissions.ts`
- `DEFAULT_DENY_LIST` — built-in deny list of catastrophic tool patterns
- `buildDenyList(permissions?)` — merge defaults with workspace-specific deny rules
- `buildDisallowedToolsArgs(permissions?)` — construct `--disallowedTools` CLI arguments
- `validatePermissions(permissions)` — validate permissions config structure

### `src/config.ts`
- `readConfig(): Config` — read and parse `~/.murmur/config.json`
- `writeConfig(config: Config)` — atomic write (write temp file, rename)
- `parseInterval(s: string): number` — `"30m"` --> `1800000`, `"1h"` --> `3600000`
- `isDue(ws: WorkspaceConfig): boolean` — `lastRun + interval < now`
- `ensureDataDir()` — create `~/.murmur/` if missing
- Validates `permissions` field on workspace configs via `validatePermissions()`

### `src/stream-parser.ts`
- `parseStreamJson(ndjson, callbacks?)` — parse complete Claude CLI `--output-format stream-json` output
- `createStreamProcessor(callbacks?)` — incremental NDJSON parser for real-time streaming
- Extracts tool calls (name, input, output), assistant text, and result metadata

### `src/heartbeat.ts`
- `runHeartbeat(ws, emit?, options?)` — full cycle: build prompt, spawn, classify, return. Accepts `{ verbose: true }` to enable stream-json parsing with tool call extraction
- `buildPrompt(ws: WorkspaceConfig): Promise<string>` — read HEARTBEAT.md, wrap in template
- `classify(stdout: string, exitCode: number): Outcome` — determine ok/attention/error
- Applies `buildDisallowedToolsArgs()` when spawning Claude to enforce the deny list

### `src/log.ts`
- `appendLog(entry: LogEntry)` — append JSON line to `~/.murmur/heartbeats.jsonl` (uses `appendFileSync` from `node:fs`)

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
2. `src/heartbeat.ts` — core logic (testable via `murmur beat`)
3. `src/log.ts` — output
4. `src/daemon.ts` — the loop
5. `src/cli.ts` — tie it together
6. Tests for classify, config parsing, interval parsing
7. `package.json` bin field + `bun link`

## Verbose Beat Mode

When `murmur beat --verbose` (or `-V`) is passed:

1. Claude is invoked with `--output-format stream-json` to produce NDJSON
2. Each line is parsed incrementally to extract tool calls, assistant text, and results
3. Tool calls are displayed in real-time as `[tool] ToolName(input)` during execution
4. After completion, a full conversation summary is printed showing all turns
5. The full conversation is saved to `~/.murmur/last-beat-{workspace}.json`
6. The `LogEntry` in `heartbeats.jsonl` includes a `turns` array with all conversation turns

### Stream-JSON Event Types

The NDJSON stream from Claude Code CLI contains these event types:

- `{ type: "system", subtype: "init" }` — session initialization (ignored)
- `{ type: "assistant", message: { content: [...] } }` — assistant messages with text and/or tool_use blocks
- `{ type: "user", message: { content: [...] } }` — tool_result blocks
- `{ type: "result", subtype: "success", result, total_cost_usd, num_turns }` — final result

## Verification Plan

1. `bun test` — unit tests pass (including stream-parser tests)
2. `murmur init .` — creates HEARTBEAT.md
3. `murmur beat .` — fires one heartbeat, prints result, appends to JSONL
4. `murmur beat --verbose .` — fires heartbeat with tool call visibility, saves conversation log
5. `murmur start` --> wait --> check `~/.murmur/heartbeats.jsonl` for entries
6. Edit HEARTBEAT.md to include a failing check --> verify attention outcome logged
7. `murmur status` — shows daemon running, workspace states
8. `murmur stop` — clean shutdown
