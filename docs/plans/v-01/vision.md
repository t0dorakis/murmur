# Murmur — Vision

## Problem

You want Claude to check your email every hour. Triage new GitHub issues twice a day. Verify your staging deploy is healthy every 30 minutes. These are things you'd ask Claude to do yourself — but you shouldn't have to remember to ask. They should just happen, repeatedly, in the background.

The core unit is simple: a prompt. You write it once, murmur runs it on a schedule. Claude executes it with full tool access — bash, MCP servers, file system — and either reports back or stays quiet.

OpenClaw solves a similar problem with its "heartbeat" — a periodic message injected into an active agent session. But OpenClaw is a full platform. You just want the heartbeat part, and you want it to work with regular Claude Code.

## Core Idea

You write a prompt in a markdown file. Murmur feeds it to Claude on an interval. If Claude has nothing to report, silence. If something needs your attention, it shows up in the log.

```
HEARTBEAT.md:
  "Check my Gmail for anything urgent in the last hour.
   If nothing urgent, respond HEARTBEAT_OK."

Murmur: runs this every 30 minutes via `claude -p`
```

That's the whole thing. A prompt that runs on repeat.

## Principles

1. **Plain files over databases** — JSON config, JSONL logs, Markdown prompts. No SQLite, no migrations, no schema. Everything is human-readable, grep-able, git-friendly.
2. **Fresh context per beat** — Each heartbeat is a new `claude` invocation. No session history, no context bloat. Files and git are the memory (Ralph Wiggum pattern).
3. **Silent unless useful** — HEARTBEAT_OK is suppressed. You only see output when something actually needs your attention.
4. **Minimal surface area** — 5 commands, 6 source files. If you can understand it in 10 minutes, it's the right size.
5. **No external dependencies** — Bun + Claude CLI. That's the entire stack.

## Feedback Loop

```
  You write a prompt in HEARTBEAT.md
    "Check my email for anything urgent"
    "Look for new GitHub issues and triage them"
    "Verify the staging deploy is healthy"
        |
        v
  Murmur feeds it to Claude on a schedule
        |
        v
  Claude does the thing
        |
        +-- Nothing to report --> silence (HEARTBEAT_OK)
        |
        +-- Needs attention --> logged, printed by `murmur status`
                |
                v
          You act on it, maybe refine the prompt
```

## What a Prompt Can Do

Because each heartbeat runs through `claude -p` with full tool access, your prompt can ask Claude to do anything Claude Code can do:

- **Read email** via Gmail MCP server
- **Triage GitHub issues** via `gh` CLI
- **Run tests** via `bun test`
- **Check deploy status** via API calls
- **Scan for security issues** in recent commits
- **Summarize Slack channels** via MCP
- **Anything you'd type into Claude Code yourself**

The prompt is just the starting instruction. Claude figures out the rest.

## Inspirations

### OpenClaw Heartbeat

Periodic trigger (default 30min) that injects a prompt into an active agent session. Uses `HEARTBEAT.md` as a persistent checklist. Agent responds `HEARTBEAT_OK` when nothing needs attention (suppressed from user). Known issue: context bloat from replaying full conversation history each heartbeat.

### Ralph Wiggum Pattern

Fresh context window each iteration. Git and files are the persistence layer — not the conversation. Progress lives in the filesystem, not in token windows. Avoids context compaction and bloat entirely.

### Murmur's Synthesis

Take the heartbeat trigger from OpenClaw. Take the fresh-context-per-iteration from Ralph Wiggum. Result: periodic prompt execution with zero context bloat, where the filesystem is the only shared state between runs. Each prompt runs in a fresh Claude session with full tool access — it can read files, call APIs, use MCP servers, run commands — then reports back.
