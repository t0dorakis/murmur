# murmur

![Bun](https://img.shields.io/badge/Bun-black?logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Effect-TS](https://img.shields.io/badge/Effect--TS-000000)
![oxlint](https://img.shields.io/badge/oxlint-checked-7C5CFC)
![oxfmt](https://img.shields.io/badge/oxfmt-formatted-7C5CFC)
![MIT License](https://img.shields.io/badge/License-MIT-yellow)

A cron daemon for Claude Code. Schedule automated Claude sessions that run on intervals or cron expressions — each one a fresh CLI invocation with full tool access.

Murmur is deliberately minimal: it schedules, runs, and logs. What happens inside each session — checking APIs, sending notifications, updating files — is defined by you and your agent in a markdown prompt. Claude builds the pipeline.

**Get started in one conversation:**

```bash
npx skills add t0dorakis/murmur --skill heartbeat-cron
```

Then: `/heartbeat-cron watch my GitHub issues and alert me when something urgent comes in`

## Or install manually


```bash
brew install t0dorakis/murmur/murmur
```

From source:

```bash
git clone https://github.com/t0dorakis/murmur.git
cd murmur && bun install && bun run build
```

## Manual Setup

If you prefer to write the heartbeat yourself:

```bash
murmur init ~/repos/my-project    # Creates HEARTBEAT.md + registers workspace
vim ~/repos/my-project/HEARTBEAT.md
murmur start                       # Start the daemon
```

The daemon reads `~/.murmur/config.json` and runs each workspace on schedule. Press `q` to quit, `Ctrl-D` to detach.

## Usage

```
murmur start [--tick <interval>]   Start daemon (foreground, TUI)
murmur start --detach              Start daemon (background)
murmur watch                       Attach TUI to running daemon
murmur stop                        Stop daemon
murmur status                      Show daemon and workspace status
murmur beat [path] [--name <name>] Run one heartbeat immediately
murmur init [path] [--name <name>] Create HEARTBEAT.md template
```

## HEARTBEAT.md

The prompt file. Write what you want your Agent to do on each run — or let the skill generate it through an interview.

HEARTBEAT.md supports optional YAML frontmatter for per-heartbeat configuration:

```markdown
---
name: Issue Worker
description: Picks up triaged GitHub issues
interval: 30m
timeout: 30m
maxTurns: 50
agent: claude-code
model: opus
# session: my-session
# permissions: skip
---

# Do this

Check for new issues...
```

Frontmatter values override config.json. Config.json values are used as fallback. A HEARTBEAT.md without frontmatter works unchanged.

| Frontmatter Field | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `name`            | Display name in TUI (falls back to `# heading`, then dirname) |
| `description`     | Description shown in TUI (falls back to content preview)      |
| `interval`        | Run every N units: `15m`, `1h`, `6h`, `1d`                    |
| `cron`            | Cron expression (alternative to interval)                     |
| `tz`              | Timezone for cron                                             |
| `timeout`         | Execution timeout: `15m`, `1h` (default: 5m)                  |
| `maxTurns`        | Cap agent iterations per heartbeat                            |
| `agent`           | Agent harness: `claude-code` (default), `pi`                  |
| `model`           | Model selection (e.g., `opus`, `anthropic/claude-sonnet-4.5`) |
| `session`         | Session ID for context reuse (pi agent)                       |
| `permissions`     | `skip` only (deny lists require config.json)                  |

**Response protocol:**

- `HEARTBEAT_OK` — nothing to report (silent, just logged)
- `ATTENTION: <summary>` — needs attention (surfaced in TUI)

But often your heartbeat handles delivery itself (write to a file, create an issue, post somewhere). The protocol is just for murmur's logs and TUI.

### Examples

**Research curation:**

```markdown
Search arxiv for new papers on "autonomous AI agents" from the last 24 hours.
For each relevant paper, extract: title, authors, key findings, and why it matters.
Create a note in ~/obsidian/research/agents/ with today's date.
If nothing relevant, HEARTBEAT_OK.
```

**GitHub digest:**

```markdown
Check my GitHub notifications using `gh`.
Filter out bot comments and CI noise.
For anything that needs my attention (review requests, mentions, failing checks on my PRs), write a summary to ~/notes/github-daily.md.
If inbox zero, HEARTBEAT_OK.
```


**Competitor watch:**

```markdown
Fetch the changelog from https://competitor.com/changelog.
Compare against ~/tracking/competitor-last.md to find new features.

For each new feature:

- Consider: does this make sense for our product? Check our existing issues and roadmap in this repo.
- Think about our users, our positioning, and whether this aligns with where we're headed.
- Only if it genuinely adds value: create a GitHub issue with `gh issue create`, explaining the feature idea and your reasoning.

Update competitor-last.md with current state.
If nothing new or nothing worth proposing, HEARTBEAT_OK.
```

## Config

`~/.murmur/config.json` — workspace paths and mutable state. Schedule and agent configuration lives in HEARTBEAT.md frontmatter (preferred) or config.json (fallback).

```json
{
  "workspaces": [
    {
      "path": "/Users/you/repos/my-project"
    },
    {
      "path": "/Users/you/repos/research",
      "cron": "0 9 * * 1-5",
      "tz": "America/New_York"
    }
  ]
}
```

| Field      | Description                                               |
| ---------- | --------------------------------------------------------- |
| `path`     | Absolute path to workspace root                           |
| `interval` | Run every N units: `15m`, `1h`, `6h`, `1d`                |
| `cron`     | Cron expression (alternative to interval): `0 9 * * 1-5`  |
| `tz`       | Timezone for cron (default: system)                       |
| `timeout`  | Execution timeout: `15m`, `1h` (default: 5m)              |
| `maxTurns` | Cap agent iterations per heartbeat (default: unlimited)   |
| `agent`    | Agent harness to use: `claude-code` (default), `pi`, etc. |
| `model`    | Model selection (agent-agnostic)                          |
| `session`  | Session ID for context reuse                              |

All config fields can also be set in HEARTBEAT.md frontmatter (takes precedence). Use `interval` or `cron`, not both.

### Multiple Heartbeats per Repo

A single workspace can have multiple heartbeats by placing them in a `heartbeats/` directory:

```
my-project/
├── HEARTBEAT.md                          # root heartbeat (optional)
├── heartbeats/
│   ├── deploy-monitor/
│   │   └── HEARTBEAT.md                  # named heartbeat
│   └── issue-worker/
│       └── HEARTBEAT.md                  # named heartbeat
└── src/
```

The daemon auto-discovers all heartbeats in `heartbeats/` — one `murmur init` registers the workspace, and `murmur start` runs them all. Each heartbeat has its own schedule (via frontmatter) and runs independently, sharing the repo root as working directory.

```bash
# Scaffold new named heartbeats:
murmur init ~/repos/my-project --name deploy-monitor
murmur init ~/repos/my-project --name issue-worker

# Run a specific one:
murmur beat ~/repos/my-project --name issue-worker
```

## Agent Harnesses

Murmur supports multiple AI agent harnesses, allowing you to choose the best tool for each heartbeat:

**Claude Code (default):**

```markdown
---
agent: claude-code
interval: 1h
model: opus
---
```

**Pi ([pi-mono](https://github.com/badlogic/pi-mono)):**

```markdown
---
agent: pi
model: anthropic/claude-sonnet-4.5
session: research-daily
cron: 0 9 * * *
---
```

| Agent         | Description                        | Config Options                     |
| ------------- | ---------------------------------- | ---------------------------------- |
| `claude-code` | Anthropic's official CLI (default) | `maxTurns`, `permissions`, `model` |
| `pi`          | Minimal coding agent by @badlogic  | `model`, `session`                 |

If `agent` is not specified, murmur defaults to `claude-code`.

## Extending

Murmur runs your prompts. Everything else — API calls, webhooks, notifications — lives inside the heartbeat itself. Claude can build these for you.

**Helpful skills:**

- [`skill-creator`](https://github.com/anthropics/skills) — Build reusable skills for integrations you use often
- [`webhook-skills`](https://github.com/hookdeck/webhook-skills) — Patterns for Slack, Discord, GitHub webhooks with signature verification
- [skills.sh](https://skills.sh) — Browse community skills for common integrations

Need Slack notifications? Your heartbeat calls the webhook. Need to create GitHub issues? Use `gh`. The heartbeat _is_ the integration.

## Permissions

Murmur runs with `--dangerously-skip-permissions` but blocks destructive commands by default (`rm -rf /`, `sudo`, `mkfs`, etc).

**Philosophy:** Blacklisting beats whitelisting for agent UX — tools work without prompts. Works best with capable models (Opus recommended).

For more safety, run murmur in a container or VM.

## Logs

Heartbeat results append to `~/.murmur/heartbeats.jsonl`:

```jsonl
{"ts":"2026-02-03T10:00:00Z","workspace":"/Users/you/repos/research","outcome":"ok","durationMs":8200}
{"ts":"2026-02-03T10:30:12Z","workspace":"/Users/you/repos/research","outcome":"attention","durationMs":14500,"summary":"3 new papers on autonomous agents"}
```

Outcomes: `ok`, `attention`, `error`.

## Best Practices

**Add a browser tool.** Many useful heartbeats need to interact with real websites — checking prices, monitoring pages, filling forms. Claude's built-in `WebFetch` works for simple static pages, but sites with JavaScript rendering, login flows, or anti-bot measures need a real browser. Two good options:

- [**agent-browser**](https://github.com/vercel-labs/agent-browser) — Headless browser CLI for AI agents. Works with Claude Code out of the box.
- [**pi-browser**](https://github.com/badlogic/pi-mono) — Browser extension for pi. Use with `agent: pi`.

**Use CLIs as tools.** Claude can run any CLI command, so install tools that give your heartbeats superpowers: [`gh`](https://cli.github.com/) for GitHub, [`jq`](https://jqlang.github.io/jq/) for JSON processing, [`rg`](https://github.com/BurntSushi/ripgrep) for fast search. The more CLIs available, the more your heartbeats can do without custom scripts.

**Use the heartbeat skill.** The `heartbeat-cron` skill interviews you, drafts the prompt, tests it, and registers it — no manual config editing. It also searches for relevant tools and skills that can help with your specific use case.

**One heartbeat, one purpose.** Keep each HEARTBEAT.md focused on a single automation. Need multiple automations in the same repo? Use `murmur init --name <name>` to create heartbeats in `heartbeats/<name>/HEARTBEAT.md` — they share the repo root as CWD but run on independent schedules. This keeps prompts small, context clean, and failures isolated.

**Start with file-based delivery.** Writing results to a markdown file in the workspace is the simplest delivery method and great for getting started. Add Slack webhooks, Telegram bots, or push notifications once the heartbeat logic is dialed in.

## FAQ

### What happens if my machine sleeps?

When the machine enters standby, the daemon process freezes — no ticks fire. On wake, the daemon resumes and any overdue jobs run immediately. Multiple missed runs collapse into a single catch-up execution (e.g., if a 1h interval workspace misses 5 hours of sleep, one heartbeat fires on wake, not five).

This is correct for heartbeat-style tasks: you want to check current state, not replay missed checks.

### How do I prevent missed heartbeats on a server?

If you're running murmur on an always-on machine (Mac Mini, Linux server), just disable sleep:

**macOS:**

```bash
# Never sleep (display can still sleep)
sudo pmset -a sleep 0 displaysleep 10
```

**Linux:**

```bash
# Disable suspend
sudo systemctl mask sleep.target suspend.target
```

Alternatively, use `caffeinate` on macOS to prevent sleep while the daemon runs:

```bash
caffeinate -s -w $(cat ~/.murmur/murmur.pid)
```

## Development

```bash
bun install          # dependencies
bun run build        # compile to ./murmur
bun test src/        # unit tests
bun run test:e2e     # e2e tests (requires binary + Claude CLI)
```

## License

MIT
