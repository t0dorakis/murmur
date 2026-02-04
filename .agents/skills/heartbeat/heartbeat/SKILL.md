---
name: heartbeat
description: >
  Create and refine HEARTBEAT.md files for murmur — the CLI daemon that runs
  scheduled Claude prompts. Use this skill when the user wants to set up a
  recurring automated action (e.g., "monitor my GitHub issues", "check Hacker
  News for AI articles", "watch my endpoints"). Triggers: heartbeat, murmur,
  recurring task, scheduled action, cron, monitor, watch, automate, periodic check.
---

# Heartbeat Creator

Create well-crafted HEARTBEAT.md files for murmur through a structured interview, test run, and refinement loop.

## Context

Murmur is a minimal scheduler. It reads a HEARTBEAT.md file, sends its contents to Claude on a schedule, and classifies the response:
- `HEARTBEAT_OK` — nothing to report (silent)
- `ATTENTION: ...` — needs human attention (logged + surfaced in TUI)

**Murmur cannot notify the user.** It only runs the prompt and logs the result. If the user wants notifications (Slack, Telegram, push), the HEARTBEAT.md itself must include the delivery step. The heartbeat is the entire pipeline: gather data → decide → act → deliver.

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
