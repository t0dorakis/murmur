---
name: heartbeat-cron
description: >
  Create and refine HEARTBEAT.md files for murmur — a CLI daemon that runs
  scheduled Claude prompts on a cron or interval schedule. Use this skill when
  the user wants to set up a recurring automated action (e.g., "monitor my
  GitHub issues", "check Hacker News for AI articles", "watch my endpoints",
  "send me a daily digest"). Guides the user through an interview, drafts the
  heartbeat prompt, tests it, and registers it with murmur's scheduler.
  Triggers: heartbeat, murmur, recurring task, scheduled action, cron, monitor,
  watch, automate, periodic check, scheduled prompt.
metadata:
  author: t0dorakis
  version: "0.1.1"
---

# Heartbeat Creator

Create well-crafted HEARTBEAT.md files for murmur through a structured interview, test run, and refinement loop.

## Context

Murmur is a minimal scheduler. It reads a HEARTBEAT.md file, sends its contents to Claude on a schedule, and classifies the response:
- `HEARTBEAT_OK` — nothing to report (silent)
- `ATTENTION: ...` — needs human attention (logged + surfaced in TUI)

**Murmur cannot notify the user.** It only runs the prompt and logs the result. If the user wants notifications (Slack, Telegram, push), the HEARTBEAT.md itself must include the delivery step. The heartbeat is the entire pipeline: gather data → decide → act → deliver.

**Each heartbeat is stateless.** Every run is a fresh Claude session with no memory of previous runs. For workflows that need to track changes over time (price deltas, last-checked timestamps), use files in the workspace as simple state stores (e.g., `last-price.txt`, `tracking-state.json`).

**Sleep/wake behavior.** When the machine sleeps, the daemon freezes — no ticks fire. On wake, overdue jobs run immediately but multiple missed runs collapse into a single catch-up execution (not one per missed interval). This is correct for heartbeat-style tasks: you want to check current state, not replay missed checks. If the user needs reliable scheduling, advise them to disable sleep on their machine (see FAQ in README).

## Workflow

### 0. Preflight

Before starting, verify murmur is installed:

```bash
which murmur
```

- **Found** → continue to interview.
- **Not found** → install via Homebrew:
  ```bash
  brew install t0dorakis/murmur/murmur
  ```
  If Homebrew isn't available, install from source:
  ```bash
  git clone https://github.com/t0dorakis/murmur.git
  cd murmur && bun install && bun run build
  # Then add ./murmur to PATH
  ```

### 1. Interview

Conduct a focused interview using AskUserQuestion. Go one or two questions at a time, building on previous answers.

**Round 1 — The goal:**

Ask what they want automated. If they're unsure or exploring, read [references/examples.md](references/examples.md) for inspiration across categories: code/repos, research/intelligence, ops/infrastructure, personal/creative. Suggest examples that match their context.

**Round 1b — Tool discovery:**

Before diving into details, check whether the user's goal needs tools beyond what's already installed. Run a web search to find relevant CLIs, MCP servers, or agent skills that could help.

**Browser tools** — Many valuable heartbeats need to interact with real websites (checking prices, monitoring pages, logging into portals). Claude's built-in `WebFetch` works for simple static pages, but sites with JavaScript rendering, login flows, or anti-bot measures need a real browser:
- [agent-browser](https://github.com/vercel-labs/agent-browser) — Headless browser CLI for AI agents. Works with Claude Code out of the box.
- [pi-browser](https://github.com/badlogic/pi-mono) — Browser extension for pi. Use with `agent: pi`.

**Other tools** — Search the web for: `"{user's goal}" CLI tool` or `"{user's goal}" MCP server` or check [skills.sh](https://skills.sh) for community skills. Examples:
- Calendar access → Google Calendar MCP or pi-google-calendar extension
- Slack/Discord delivery → webhook skills on [skills.sh](https://skills.sh)
- GitHub operations → ensure `gh` CLI is installed

Tell the user what you found and recommend installing anything that would make the heartbeat more capable.

**Round 2 — The details:**

Based on their goal, dig into specifics:
- What tools/APIs/commands are needed? (gh, curl, specific URLs, API keys)
- What's the workspace directory?
- How often should it run? Two options:
  - **Interval** — fixed frequency: `15m`, `1h`, `6h`, `1d`
  - **Cron** — precise schedule: `0 9 * * 1-5` (weekdays at 9am), `*/30 * * * *` (every 30 min)
  - If they pick cron, ask about timezone (defaults to local system tz)

**Round 3 — Delivery:**

This is critical. Ask how they want results delivered. Options:
- Write to a file in the workspace (simplest — good default)
- Post to Slack/Discord via webhook
- Send via Telegram bot API
- Create a GitHub issue/comment
- Push notification via ntfy.sh
- Just use ATTENTION response (user checks TUI/logs)

Remind them: murmur is just a scheduler — it won't forward anything. If they want to be notified, the heartbeat itself must do the notifying.

**Round 3b — Credentials (if needed):**

If delivery or data sources need tokens/webhooks:
- Env vars from `.env` in the workspace are available (Bun auto-loads them)
- Sensitive values should go in `.env`, referenced as `$VAR_NAME` in the heartbeat

### 2. Draft

Write the HEARTBEAT.md file. Rules:

- Start with `# Heartbeat` and the standard preamble about HEARTBEAT_OK / ATTENTION
- Be explicit about every step — Claude has no memory between heartbeats
- For change-detection workflows (price drops, new items, status changes), include steps to read/write state files in the workspace (e.g., `last-price.txt`, `tracking-state.json`)
- Include exact commands with real values (no `{placeholder}` left behind)
- Include the delivery step if the user wants notifications
- Keep it focused — one purpose per heartbeat
- Use `$VAR_NAME` for secrets

Place the file at `{workspace}/HEARTBEAT.md`. If not initialized, run `murmur init {path}` first.

### 3. Test

Run one heartbeat to verify:

```bash
murmur beat {workspace_path}
```

Show the user the outcome and output.

### 4. Evaluate

Ask the user: "Did that do what you expected?"

- **No** → refine the HEARTBEAT.md based on feedback, test again. Repeat until satisfied.
- **Yes** → proceed to register.

### 5. Register

Ensure the workspace is in murmur's config (`~/.murmur/config.json`):

1. Check for an existing entry with this workspace path
2. If missing, add it with the agreed schedule. Use **either** `interval` or `cron`, never both:

   **Interval-based:**
   ```json
   {
     "path": "{absolute_workspace_path}",
     "interval": "{interval}",
     "lastRun": null
   }
   ```

   **Cron-based:**
   ```json
   {
     "path": "{absolute_workspace_path}",
     "cron": "{cron_expression}",
     "tz": "{timezone}",
     "lastRun": null
   }
   ```
   Omit `tz` if the user is fine with their local system timezone.

3. Optional: set `"maxTurns": N` to cap Claude's agent iterations per heartbeat
4. Tell the user to start murmur if not running: `murmur start`

## Rules

- Never leave `{placeholder}` values in the final HEARTBEAT.md
- Always test with `murmur beat` before declaring done
- Always ask the user to evaluate the test result
- If a heartbeat needs tools the user doesn't have installed, tell them what to install
- One heartbeat = one purpose. Multiple automations = multiple workspaces.
- Schedule suggestions: `15m` for uptime, `1h` for active dev work, `6h`–`1d` for digests/research. Use cron when the user wants specific times (e.g., `0 9 * * 1-5` for weekday mornings).
