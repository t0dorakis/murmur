import {
  altScreenOn, altScreenOff, cursorHide, cursorShow, cursorHome,
  clearLine, clearToEnd, moveTo, write,
  reset, bold, dim, green, yellow, red, white, gray,
  styled, terminalWidth, truncate, padRight,
} from "./ansi.ts";
import type { DaemonEvent, Outcome, WorkspaceStatus } from "./types.ts";

export type EventSource = {
  subscribe(callback: (event: DaemonEvent) => void): void;
  unsubscribe(callback: (event: DaemonEvent) => void): void;
};

type FeedEntry = {
  workspace: string;
  name: string;
  promptPreview: string;
  outcome: Outcome | null;
  durationMs: number | null;
  output: string;
};

type TuiState = {
  pid: number;
  workspaces: WorkspaceStatus[];
  feed: FeedEntry[];
  activeBeat: { workspace: string; output: string; startedAt: number } | null;
};

export type Tui = {
  start(): void;
  stop(): void;
};

// --- Formatting helpers ---

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${rem}s`;
}

function formatCountdown(targetMs: number): string {
  const diff = targetMs - Date.now();
  if (diff <= 0) return "due";
  const totalSec = Math.ceil(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatAgo(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function outcomeIcon(outcome: Outcome | null): string {
  switch (outcome) {
    case "ok": return styled("✓", green, dim);
    case "attention": return styled("●", yellow);
    case "error": return styled("✗", red);
    default: return styled("—", dim);
  }
}

function outcomeLabel(outcome: Outcome): string {
  switch (outcome) {
    case "ok": return styled("ok", green, dim);
    case "attention": return styled("attention", yellow);
    case "error": return styled("error", red);
  }
}

// --- Rendering ---

function renderHeader(state: TuiState): string {
  const wsCount = state.workspaces.length;
  return ` ${styled("murmur", bold, white)} ${styled("∙", dim)} ${wsCount} workspace${wsCount !== 1 ? "s" : ""} ${styled("∙", dim)} pid ${state.pid}`;
}

function renderWorkspaceRow(ws: WorkspaceStatus, active: boolean, tw: number): string {
  const nameWidth = Math.min(24, Math.floor(tw * 0.3));
  const name = truncate(ws.name, nameWidth);
  const interval = padRight(ws.interval, 5);

  let status: string;
  if (active) {
    const elapsed = formatDuration(Date.now() - (ws.lastRunAt ?? Date.now()));
    status = styled(`▶ running (${elapsed})`, bold, white);
  } else {
    const countdown = formatCountdown(ws.nextRunAt);
    status = countdown === "due"
      ? styled("due", dim)
      : `next in ${styled(padRight(countdown, 12), white)}`;
  }

  let lastCol: string;
  if (ws.lastRunAt) {
    lastCol = `${outcomeIcon(ws.lastOutcome)} ${ws.lastOutcome ? styled(ws.lastOutcome, dim) : ""} ${styled(formatAgo(ws.lastRunAt), dim)}`;
  } else {
    lastCol = styled("—", dim);
  }

  const nameStr = active ? styled(padRight(name, nameWidth), bold, white) : styled(padRight(name, nameWidth), white);

  return ` ${nameStr}  ${styled(interval, dim)}  ${status}  ${lastCol}`;
}

function renderSeparator(tw: number): string {
  return styled("─".repeat(tw), dim);
}

function renderActiveBeat(state: TuiState, tw: number, maxLines: number): string[] {
  if (!state.activeBeat) return [];
  const { workspace, output, startedAt } = state.activeBeat;
  const feed = state.feed.length > 0 ? state.feed : [];
  // Find name from workspaces or feed
  const wsInfo = state.workspaces.find((w) => w.path === workspace);
  const name = wsInfo?.name ?? workspace.split("/").pop() ?? workspace;
  const elapsed = formatDuration(Date.now() - startedAt);

  const lines: string[] = [];
  lines.push(` ${styled("▶", bold, white)} ${styled(name, bold, white)}${" ".repeat(Math.max(1, tw - name.length - elapsed.length - 6))}${styled(elapsed, dim)}`);

  // Find prompt preview from last feed entry for this workspace
  const feedEntry = [...feed].reverse().find((f) => f.workspace === workspace);
  if (feedEntry?.promptPreview) {
    lines.push(`   ${styled(truncate(feedEntry.promptPreview, tw - 4), dim)}`);
    lines.push(`   ${styled("┄┄┄", dim)}`);
  }

  // Stream output (last N lines that fit)
  if (output) {
    const outputLines = output.split("\n");
    const available = maxLines - lines.length;
    const start = Math.max(0, outputLines.length - available);
    for (let i = start; i < outputLines.length; i++) {
      lines.push(`   ${truncate(outputLines[i]!, tw - 4)}`);
    }
  }

  return lines;
}

function renderFeedEntry(entry: FeedEntry, tw: number): string[] {
  const name = entry.name;
  const dur = entry.durationMs != null ? formatDuration(entry.durationMs) : "";

  if (entry.outcome === "ok") {
    return [` ${outcomeIcon("ok")} ${styled(name, dim)}${" ".repeat(Math.max(1, tw - name.length - dur.length - 14))}${outcomeLabel("ok")}  ${styled(dur, dim)}`];
  }

  const icon = outcomeIcon(entry.outcome);
  const label = entry.outcome ? outcomeLabel(entry.outcome) : "";
  const lines: string[] = [];
  lines.push(` ${icon} ${styled(name, bold, white)}${" ".repeat(Math.max(1, tw - name.length - dur.length - (entry.outcome?.length ?? 0) - 10))}${label}  ${styled(dur, dim)}`);

  if (entry.promptPreview) {
    lines.push(`   ${styled(truncate(entry.promptPreview, tw - 4), dim)}`);
    lines.push(`   ${styled("┄┄┄", dim)}`);
  }

  if (entry.output) {
    const outputLines = entry.output.split("\n");
    for (const line of outputLines) {
      lines.push(`   ${truncate(line, tw - 4)}`);
    }
  }

  return lines;
}

// --- Main TUI ---

export function createTui(eventSource: EventSource): Tui {
  const state: TuiState = {
    pid: 0,
    workspaces: [],
    feed: [],
    activeBeat: null,
  };

  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  function render() {
    const tw = terminalWidth();
    const rows = process.stdout.rows ?? 24;

    write(cursorHome);

    // Header
    write(clearLine + renderHeader(state) + "\n");
    write(clearLine + "\n");

    // Workspace rows
    for (const ws of state.workspaces) {
      const active = state.activeBeat?.workspace === ws.path;
      write(clearLine + renderWorkspaceRow(ws, active, tw) + "\n");
    }

    if (state.workspaces.length === 0) {
      write(clearLine + styled(" No workspaces configured.", dim) + "\n");
      write(clearLine + styled(` Add one to config.json or run: murmur init <path>`, dim) + "\n");
    }

    write(clearLine + "\n");
    write(clearLine + renderSeparator(tw) + "\n");
    write(clearLine + "\n");

    // Fixed region height: header(1) + blank(1) + workspaces(N) + blank(1) + sep(1) + blank(1)
    const fixedLines = 5 + Math.max(state.workspaces.length, 2);
    const feedArea = rows - fixedLines;

    if (state.activeBeat) {
      // Render active beat
      const beatLines = renderActiveBeat(state, tw, Math.floor(feedArea * 0.6));
      for (const line of beatLines) {
        write(clearLine + line + "\n");
      }
      write(clearLine + "\n");
    }

    // Render completed feed entries (most recent first, fill remaining space)
    const usedByActive = state.activeBeat ? renderActiveBeat(state, tw, Math.floor(feedArea * 0.6)).length + 1 : 0;
    const feedSpace = feedArea - usedByActive;

    if (state.feed.length === 0 && !state.activeBeat) {
      write(clearLine + styled(" Waiting for first heartbeat...", dim) + "\n");
    } else {
      let linesUsed = 0;
      // Show most recent feed entries first
      for (let i = state.feed.length - 1; i >= 0 && linesUsed < feedSpace; i--) {
        const entry = state.feed[i]!;
        const entryLines = renderFeedEntry(entry, tw);
        if (linesUsed + entryLines.length > feedSpace) break;
        for (const line of entryLines) {
          write(clearLine + line + "\n");
          linesUsed++;
        }
      }
    }

    write(clearToEnd);
  }

  function handleEvent(event: DaemonEvent) {
    switch (event.type) {
      case "daemon:ready":
        state.pid = event.pid;
        break;

      case "tick":
        state.workspaces = event.workspaces;
        render();
        break;

      case "heartbeat:start": {
        state.activeBeat = {
          workspace: event.workspace,
          output: "",
          startedAt: Date.now(),
        };
        // Create a feed entry placeholder
        const wsInfo = state.workspaces.find((w) => w.path === event.workspace);
        state.feed.push({
          workspace: event.workspace,
          name: wsInfo?.name ?? event.workspace.split("/").pop() ?? event.workspace,
          promptPreview: event.promptPreview,
          outcome: null,
          durationMs: null,
          output: "",
        });
        render();
        break;
      }

      case "heartbeat:stdout":
        if (state.activeBeat?.workspace === event.workspace) {
          state.activeBeat.output += event.chunk;
        }
        render();
        break;

      case "heartbeat:done": {
        // Finalize the feed entry
        const idx = state.feed.findLastIndex((f) => f.workspace === event.workspace && f.outcome === null);
        if (idx !== -1) {
          const feedEntry = state.feed[idx]!;
          feedEntry.outcome = event.entry.outcome;
          feedEntry.durationMs = event.entry.durationMs;
          feedEntry.output = state.activeBeat?.workspace === event.workspace
            ? state.activeBeat.output
            : "";
        }
        if (state.activeBeat?.workspace === event.workspace) {
          state.activeBeat = null;
        }
        // Keep feed bounded
        if (state.feed.length > 50) state.feed.splice(0, state.feed.length - 50);
        render();
        break;
      }

      case "daemon:shutdown":
        // Will be handled by stop()
        break;
    }
  }

  return {
    start() {
      write(altScreenOn + cursorHide);
      eventSource.subscribe(handleEvent);

      // Countdown refresh every second
      countdownTimer = setInterval(() => {
        if (state.workspaces.length > 0) render();
      }, 1000);

      render();
    },

    stop() {
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
      eventSource.unsubscribe(handleEvent);
      write(cursorShow + altScreenOff);
    },
  };
}
