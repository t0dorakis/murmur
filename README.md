# Murmur

A CLI daemon that runs scheduled prompts ("heartbeats") via Claude. Write a prompt in markdown, tell murmur how often to run it, and it handles the rest — only bothering you when something needs attention.

## Install

```bash
bun install
bun link
```

Requires [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) to be installed and authenticated.

## Quick Start

```bash
# 1. Create a heartbeat prompt in any directory
murmur init ~/repos/my-project

# 2. Edit the prompt to describe what Claude should do
vim ~/repos/my-project/HEARTBEAT.md

# 3. Add the workspace to your config
vim ~/.murmur/config.json
```

```json
{
  "workspaces": [
    {
      "path": "/Users/you/repos/my-project",
      "interval": "30m",
      "maxTurns": 3,
      "lastRun": null
    }
  ]
}
```

```bash
# 4. Start the daemon
murmur start

# 5. Check on it
murmur status
```

## Commands

| Command | Description |
|---------|-------------|
| `murmur start` | Start the daemon in the background |
| `murmur stop` | Stop the daemon |
| `murmur status` | Show daemon state and workspace info |
| `murmur beat [path]` | Fire one heartbeat immediately (defaults to `.`) |
| `murmur init [path]` | Create a `HEARTBEAT.md` template |

## HEARTBEAT.md

The prompt file. Write whatever you want Claude to do on each run. Two rules for the response:

- **Nothing to report** → Claude responds with `HEARTBEAT_OK` (suppressed from output)
- **Needs attention** → Claude responds with `ATTENTION:` followed by a summary

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

| Field | Description |
|-------|-------------|
| `path` | Absolute path to workspace (must contain `HEARTBEAT.md`) |
| `interval` | How often to run: `"15m"`, `"30m"`, `"1h"`, `"2h"`, `"1d"` |
| `maxTurns` | Max agent iterations per heartbeat (default: `3`) |
| `lastRun` | ISO timestamp of last run, or `null` |

## Logs

Heartbeat results are appended to `~/.murmur/heartbeats.jsonl`:

```jsonl
{"ts":"2026-02-03T10:00:00Z","workspace":"/Users/you/repos/my-project","outcome":"ok","durationMs":8200}
{"ts":"2026-02-03T10:30:12Z","workspace":"/Users/you/repos/my-project","outcome":"attention","durationMs":14500,"summary":"2 tests failing in auth.test.ts"}
```

Outcomes: `ok` (silent), `attention` (needs action), `error` (something broke).

Browse with standard tools:
```bash
# Recent entries
tail -5 ~/.murmur/heartbeats.jsonl

# Filter attention entries
grep '"attention"' ~/.murmur/heartbeats.jsonl | jq .

# Count today's runs
grep "$(date -u +%Y-%m-%d)" ~/.murmur/heartbeats.jsonl | wc -l
```

## How It Works

1. Daemon wakes every 10 seconds
2. Reads config, checks which workspaces are due
3. For each due workspace: reads `HEARTBEAT.md`, wraps it in a prompt template, spawns `claude --print` with the prompt on stdin
4. Classifies the response (`ok` / `attention` / `error`), appends to log, updates `lastRun`
5. Each heartbeat is a fresh Claude invocation — no session history, no context bloat
