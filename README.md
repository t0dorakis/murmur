# murmur

A cron daemon for Claude Code. Schedule automated Claude sessions that run on intervals or cron expressions — each one a fresh CLI invocation with full tool access.

Murmur is deliberately minimal: it schedules, runs, and logs. What happens inside each session — checking APIs, sending notifications, updating files — is defined by you and your agent in a markdown prompt. Claude builds the pipeline.

**Get started in one conversation:**

```bash
npx skills add t0dorakis/murmur --skill heartbeat-cron
```

Then: `/heartbeat-cron watch my GitHub issues and alert me when something urgent comes in`

## Install

**Recommended:** Install the skill, then let Claude handle the rest:

```bash
npx skills add t0dorakis/murmur --skill heartbeat-cron
```

The skill prompts you to install murmur if needed.

**Or install manually:**

```bash
brew install t0dorakis/murmur/murmur
```

From source:
```bash
git clone https://github.com/t0dorakis/murmur.git
cd murmur && bun install && bun run build
```

Requires [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) installed and authenticated.

## Manual Setup

If you prefer to write the heartbeat yourself:

```bash
murmur init ~/repos/my-project    # Creates HEARTBEAT.md template
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
murmur beat [path]                 Run one heartbeat immediately
murmur init [path]                 Create HEARTBEAT.md template
```

## HEARTBEAT.md

The prompt file. Write what you want Claude to do on each run — or let the skill generate it through an interview.

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

**Price monitor:**
```markdown
Check the current price of the product at the URL below.

URL: https://store.steampowered.com/app/1245620/ELDEN_RING/

1. Read the last known price from `last-price.txt` in this directory
2. Fetch the product page and extract the current price
3. If `last-price.txt` doesn't exist, create it with the current price and respond HEARTBEAT_OK
4. If the price changed: ATTENTION: Price changed to $CURRENT (was $PREVIOUS)
5. Update `last-price.txt` with the current price
6. If unchanged, respond HEARTBEAT_OK
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

## Execution Model

Each heartbeat is a fresh Claude CLI invocation. There is no conversation history or memory between runs — Claude starts from scratch every time.

This is intentional: it prevents context bloat, keeps behavior predictable, and means a single bad run can't corrupt future ones.

**To persist state between heartbeats, use files.** Claude can read and write files in the workspace directory. Common patterns:

- **Track processed items** — write seen IDs to `.heartbeat-state.json` so you don't re-process them
- **Detect changes** — save the previous state to a file and diff against the current state on the next run
- **Accumulate results** — append to a log file or markdown document across runs

The price monitor and competitor watch examples above both demonstrate this pattern.

## Config

`~/.murmur/config.json` — workspaces and their schedules.

```json
{
  "workspaces": [
    {
      "path": "/Users/you/repos/my-project",
      "interval": "30m"
    },
    {
      "path": "/Users/you/repos/research",
      "cron": "0 9 * * 1-5",
      "tz": "America/New_York"
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `path` | Absolute path to workspace (must contain `HEARTBEAT.md`) |
| `interval` | Run every N units: `15m`, `1h`, `6h`, `1d` |
| `cron` | Cron expression (alternative to interval): `0 9 * * 1-5` |
| `tz` | Timezone for cron (default: system) |
| `maxTurns` | Cap agent iterations per heartbeat (default: unlimited) |
| `agent` | Agent harness to use: `claude-code` (default), `pi`, etc. |

Use `interval` or `cron`, not both.

## Agent Harnesses

Murmur supports multiple AI agent harnesses, allowing you to choose the best tool for each heartbeat:

**Claude Code (default):**
```json
{
  "path": "/Users/you/repos/project",
  "agent": "claude-code",
  "interval": "1h"
}
```

**Pi ([pi-mono](https://github.com/badlogic/pi-mono)):**
```json
{
  "path": "/Users/you/repos/research",
  "agent": "pi",
  "piExtensions": ["@mariozechner/pi-browser"],
  "piSession": "research-daily",
  "piModel": "anthropic/claude-sonnet-4.5",
  "cron": "0 9 * * *"
}
```

| Agent | Description | Config Options |
|-------|-------------|----------------|
| `claude-code` | Anthropic's official CLI (default) | `maxTurns`, `permissions` |
| `pi` | Minimal coding agent by @badlogic | `piExtensions`, `piSession`, `piModel` |

**Pi-specific options:**
- `piExtensions` — Array of pi extensions to load (e.g., `["@mariozechner/pi-google-calendar"]`)
- `piSession` — Session ID for context reuse across heartbeats
- `piModel` — Model/provider to use (e.g., `"anthropic/claude-sonnet-4.5"`)

If `agent` is not specified, murmur defaults to `claude-code` for backward compatibility.

## Extending

Murmur runs your prompts. Everything else — API calls, webhooks, notifications — lives inside the heartbeat itself. Claude can build these for you.

**Helpful skills:**

- [`skill-creator`](https://github.com/anthropics/skills) — Build reusable skills for integrations you use often
- [`webhook-skills`](https://github.com/hookdeck/webhook-skills) — Patterns for Slack, Discord, GitHub webhooks with signature verification
- [skills.sh](https://skills.sh) — Browse community skills for common integrations

Need Slack notifications? Your heartbeat calls the webhook. Need to create GitHub issues? Use `gh`. The heartbeat *is* the integration.

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
- [**pi-browser**](https://github.com/badlogic/pi-mono) — Browser extension for pi. Use with `"agent": "pi"` and `"piExtensions": ["@mariozechner/pi-browser"]`.

**Use CLIs as tools.** Claude can run any CLI command, so install tools that give your heartbeats superpowers: [`gh`](https://cli.github.com/) for GitHub, [`jq`](https://jqlang.github.io/jq/) for JSON processing, [`rg`](https://github.com/BurntSushi/ripgrep) for fast search. The more CLIs available, the more your heartbeats can do without custom scripts.

**Use the heartbeat skill.** The `heartbeat-cron` skill interviews you, drafts the prompt, tests it, and registers it — no manual config editing. It also searches for relevant tools and skills that can help with your specific use case.

**One heartbeat, one purpose.** Keep each HEARTBEAT.md focused on a single automation. Need multiple automations? Use multiple workspaces with different schedules. This keeps prompts small, context clean, and failures isolated.

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
