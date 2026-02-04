# murmur

Scheduled Claude prompts that only speak when something needs attention. Write a prompt in markdown, tell murmur how often to run it, and it handles the rest — staying silent unless there's something you should know.

Inspired by the heartbeat concept from [OpenClaw](https://github.com/openclaw) (formerly clawdbot), repacked into a minimal form factor that works with just [Claude Code](https://docs.anthropic.com/en/docs/claude-cli). Each prompt runs as a fresh Claude CLI invocation with full tool access (bash, MCP servers, file system). No session history, no context bloat. Files and git are the memory.

## Install

**Homebrew (macOS/Linux):**
```bash
brew install t0dorakis/murmur/murmur
```

**From source:**
```bash
git clone https://github.com/t0dorakis/murmur.git
cd murmur && bun install && bun run build
```

This compiles a standalone `./murmur` binary. Requires [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) installed and authenticated.

## Quick Start

```bash
# Create a heartbeat prompt in any project
murmur init ~/repos/my-project

# Edit the prompt — describe what Claude should check
vim ~/repos/my-project/HEARTBEAT.md

# Start the daemon
murmur start
```

The daemon reads `~/.murmur/config.json` and runs each workspace on its schedule. Press `q` to quit, `Ctrl-D` to detach to background.

## Usage

```
murmur start [--tick <interval>]   Start daemon with TUI (foreground)
murmur start --detach              Start daemon in background
murmur watch                       Attach TUI to running daemon
murmur stop                        Stop the daemon
murmur status                      Show daemon and workspace status
murmur beat [path]                 Run one heartbeat immediately
murmur init [path]                 Create HEARTBEAT.md template
```

## HEARTBEAT.md

The prompt file. Write whatever you want Claude to do on each run. Two rules for the response:

- **Nothing to report** → respond with `HEARTBEAT_OK` (suppressed from output)
- **Needs attention** → respond with `ATTENTION:` followed by a summary

### Examples

**Run tests and check git status:**
```markdown
Run `bun test` and check `git status`.
If tests pass and no uncommitted work, respond HEARTBEAT_OK.
Otherwise tell me what's wrong.
```

**Monitor GitHub issues:**
```markdown
Check for new GitHub issues on my-org/my-repo using `gh`.
For any untagged issues, add a triage label based on the content.
If there are urgent issues (security, data loss, outage), tell me.
```

**Verify deploys:**
```markdown
Curl https://staging.example.com/health and verify it returns 200.
Check the last 3 deploys via `gh run list`.
If anything looks off, tell me. Otherwise HEARTBEAT_OK.
```

## Config

`~/.murmur/config.json` — edit directly to add/remove workspaces.

```json
{
  "workspaces": [
    {
      "path": "/Users/you/repos/my-project",
      "interval": "30m",
      "maxTurns": 3
    },
    {
      "path": "/Users/you/repos/infra",
      "cron": "0 9,17 * * 1-5",
      "tz": "America/New_York"
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `path` | Absolute path to workspace (must contain `HEARTBEAT.md`) |
| `interval` | Run every N units: `"15m"`, `"1h"`, `"2h"`, `"1d"` |
| `cron` | Cron expression (alternative to `interval`): `"0 */6 * * *"` |
| `tz` | Timezone for cron schedules: `"America/New_York"` |
| `maxTurns` | Max agent iterations per heartbeat (default: unlimited) |

Use `interval` or `cron`, not both.

## Logs

Heartbeat results are appended to `~/.murmur/heartbeats.jsonl`:

```jsonl
{"ts":"2026-02-03T10:00:00Z","workspace":"/Users/you/repos/my-project","outcome":"ok","durationMs":8200}
{"ts":"2026-02-03T10:30:12Z","workspace":"/Users/you/repos/my-project","outcome":"attention","durationMs":14500,"summary":"2 tests failing in auth.test.ts"}
```

Outcomes: `ok` (silent), `attention` (needs action), `error` (something broke).

```bash
# Recent entries
tail -5 ~/.murmur/heartbeats.jsonl

# Filter attention entries
grep '"attention"' ~/.murmur/heartbeats.jsonl | jq .
```

## Development

```bash
bun install          # install dependencies
bun run build        # compile to ./murmur binary
bun src/cli.ts       # run from source (skip compile)
bun test src/        # unit tests
bun run test:e2e     # e2e tests (requires compiled binary + Claude CLI)
```

## License

MIT
