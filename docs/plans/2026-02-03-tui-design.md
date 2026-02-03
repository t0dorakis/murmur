# Murmur TUI Design

## Overview

A persistent terminal UI for the murmur daemon that shows live heartbeat activity. Replaces the current silent background-only mode with a foreground monitor that streams Claude's output in real-time.

## Layout

Two vertical zones separated by a thin dimmed line:

### Workspace Bar (top, fixed)

```
 murmur ∙ 3 workspaces ∙ pid 37037

 Check Email          1h    next in 42m 18s    ✓ ok 17m ago
 Project Health      30m    next in  8m 03s    ✓ ok 21m ago
 Deploy Monitor      15m    ▶ running (3.2s)   ✓ ok 14m ago
```

Each row: `# heading` from HEARTBEAT.md, interval, countdown to next fire, last outcome with relative time.

- Active heartbeat: countdown becomes `▶ running (elapsed)`, row goes bold/white
- Queued (due while another runs): shows `due` (dimmed) until it starts
- Never run: shows `—` instead of last outcome
- Countdowns update every second; "ago" timestamps update every minute

### Activity Feed (bottom, scrollable, most recent at top)

Chronological stream of heartbeat events.

## Feed Entry Formats

### Running (live streaming)

```
 ▶ Deploy Monitor                                        3.2s
   Check deployment status on staging and production...
   ┄┄┄
   Checking staging.example.com... HTTP 200, response time 142ms.
   Checking production.example.com... HTTP 200, response time 89ms.
   All deployments healthy, no rollbacks detected in the_
```

First line: workspace name + elapsed time. Dim prompt preview (first 2-3 lines of HEARTBEAT.md). Dotted separator. Claude's response streams in real-time.

### Completed — ok

```
 ✓ Deploy Monitor                              ok    8.2s
```

Single dim line. Streaming content collapses away on ok classification.

### Completed — attention

```
 ● Deploy Monitor                       attention   14.5s
   Check deployment status on staging and production...
   ┄┄┄
   ATTENTION: Staging deployment is returning HTTP 503.
   Last successful deploy was 2h ago. Current commit abc123
   appears to have introduced a regression in /api/health.
```

Stays expanded. Yellow `●` and "attention" label. Full Claude response visible.

### Completed — error

```
 ✗ Deploy Monitor                           error    0.3s
   HEARTBEAT.md not found
```

Red `✗` and "error" label. Shows the error message.

## CLI Integration

| Command | Behavior |
|---------|----------|
| `murmur start` | Foreground with TUI (new default) |
| `murmur start --detach` | Background, silent (old behavior) |
| `murmur watch` | Attach TUI to running background daemon |
| `murmur stop` | Unchanged (kills from another terminal) |

## Keyboard Controls

- `q` or `Ctrl+C` — Stop the daemon and exit
- `Ctrl+D` — Detach: daemon continues in background, TUI exits. Prints `Detached. Reattach with: murmur watch`

No other interaction. The feed auto-scrolls.

## Communication: Unix Socket

The daemon writes structured events to `~/.murmur/murmur.sock`:

- Heartbeat start (workspace, prompt preview)
- Stdout chunk (streaming output)
- Heartbeat completion (outcome, duration, summary)

In foreground mode, the TUI reads from the same event stream in-process. `murmur watch` connects to the socket and renders identically.

## Edge Cases

**Terminal resize:** Layout adapts. Workspace names truncate with `…` if narrow. Feed reflows. No horizontal scrolling.

**Long output:** Feed entries are uncapped. Old entries scroll off the top.

**Empty state:**
```
 murmur ∙ 2 workspaces ∙ pid 37037

 Check Email          1h    next in 59m 58s    —
 Project Health      30m    next in 29m 58s    —

 Waiting for first heartbeat...
```

**No workspaces:**
```
 murmur ∙ 0 workspaces ∙ pid 37037

 No workspaces configured.
 Add one to ~/.murmur/config.json or run: murmur init <path>
```

**Timeout:** Appears as error entry:
```
 ✗ Check Email                              error  300.0s
   Timed out after 5m
```

## Color Palette

| Element | Color |
|---------|-------|
| Default text | dim gray |
| Active/current | white, bold |
| ok | green (dim) |
| attention | yellow |
| error | red |
| Countdowns | white |
| Prompt preview | dim gray |
| Streaming output | normal white |
