import prettyMs from "pretty-ms";
import {
  altScreenOn,
  altScreenOff,
  cursorHide,
  cursorShow,
  cursorHome,
  clearLine,
  clearToEnd,
  bold,
  dim,
  green,
  yellow,
  red,
  white,
  styled,
  truncate,
  padRight,
  toolIcons,
  visualWidth,
} from "./ansi.ts";
import { createScreen, type Screen } from "./screen.ts";
import { formatToolTarget, formatToolDuration } from "./tool-format.ts";
import type { EventSource } from "./events.ts";
import type { DaemonEvent, Outcome, ToolCall, WorkspaceStatus } from "./types.ts";

type FeedEntry = {
  workspace: string;
  name: string;
  description?: string;
  promptPreview: string;
  outcome: Outcome | null;
  durationMs: number | null;
  output: string;
  error?: string;
  toolCount: number;
};

type ActiveBeat = {
  workspace: string;
  output: string;
  startedAt: number;
  tools: ToolCall[];
};

type TuiState = {
  pid: number;
  workspaces: WorkspaceStatus[];
  feed: FeedEntry[];
  activeBeat: ActiveBeat | null;
};

export type Tui = {
  start(): void;
  stop(): void;
};

/** Maximum number of feed entries to keep in memory. */
const MAX_FEED_ENTRIES = 50;

// --- Formatting helpers ---

function formatCountdown(targetMs: number): string {
  const diff = targetMs - Date.now();
  if (diff <= 0) return "due";
  return prettyMs(diff, { secondsDecimalDigits: 0 });
}

function formatAgo(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return "just now";
  return `${prettyMs(diff, { compact: true })} ago`;
}

function workspaceDisplayName(id: string, workspaces: WorkspaceStatus[]): string {
  return workspaces.find((w) => w.id === id)?.name ?? id;
}

function outcomeIcon(outcome: Outcome | null): string {
  switch (outcome) {
    case "ok":
      return styled("✓", green, dim);
    case "attention":
      return styled("●", yellow);
    case "error":
      return styled("✗", red);
    default:
      return styled("—", dim);
  }
}

function outcomeLabel(outcome: Outcome): string {
  switch (outcome) {
    case "ok":
      return styled("ok", green, dim);
    case "attention":
      return styled("attention", yellow);
    case "error":
      return styled("error", red);
  }
}

function formatToolLine(tool: ToolCall, termWidth: number): string {
  const icon = tool.output !== undefined ? toolIcons.complete : toolIcons.pending;
  const iconStyled = tool.output !== undefined ? icon : styled(icon, dim);
  const target = formatToolTarget(tool.input, 40);
  const duration = formatToolDuration(tool.durationMs);
  const durationStyled = duration ? ` ${styled(duration, dim)}` : "";
  const content = `${tool.name} ${styled(target, dim)}${durationStyled}`;
  return `   ${iconStyled} ${truncate(content, termWidth - 6)}`;
}

// --- Rendering ---

function renderHeader(state: TuiState): string {
  const wsCount = state.workspaces.length;
  return ` ${styled("murmur", bold, white)} ${styled("∙", dim)} ${wsCount} workspace${wsCount !== 1 ? "s" : ""} ${styled("∙", dim)} pid ${state.pid}`;
}

function formatAbsoluteTime(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function workspaceStatusText(ws: WorkspaceStatus, active: boolean): string {
  if (active) {
    const elapsed = prettyMs(Date.now() - (ws.lastRunAt ?? Date.now()));
    return styled(`▶ running (${elapsed})`, bold, white);
  }
  const diff = ws.nextRunAt - Date.now();
  if (diff > 3_600_000) {
    const time = formatAbsoluteTime(ws.nextRunAt);
    return `next at ${styled(time, white)}`;
  }
  const countdown = formatCountdown(ws.nextRunAt);
  return countdown === "due"
    ? styled("due", dim)
    : `next in ${styled(padRight(countdown, 12), white)}`;
}

function renderWorkspaceRow(ws: WorkspaceStatus, active: boolean, termWidth: number): string {
  const nameWidth = Math.min(24, Math.floor(termWidth * 0.3));
  const name = truncate(ws.name, nameWidth);
  const scheduleWidth = ws.scheduleType === "cron" ? 11 : 5;
  const schedule = padRight(ws.schedule, scheduleWidth);
  const status = workspaceStatusText(ws, active);

  let lastCol: string;
  if (ws.lastRunAt) {
    lastCol = `${outcomeIcon(ws.lastOutcome)} ${ws.lastOutcome ? styled(ws.lastOutcome, dim) : ""} ${styled(formatAgo(ws.lastRunAt), dim)}`;
  } else {
    lastCol = styled("—", dim);
  }

  const nameStr = active
    ? styled(padRight(name, nameWidth), bold, white)
    : styled(padRight(name, nameWidth), white);
  return ` ${nameStr}  ${styled(schedule, dim)}  ${status}  ${lastCol}`;
}

function renderSeparator(termWidth: number): string {
  return styled("─".repeat(termWidth), dim);
}

function renderActiveBeat(state: TuiState, termWidth: number, maxLines: number): string[] {
  if (!state.activeBeat) return [];
  const { workspace, output, tools, startedAt } = state.activeBeat;
  const name = workspaceDisplayName(workspace, state.workspaces);
  const elapsed = prettyMs(Date.now() - startedAt);

  const lines: string[] = [];
  lines.push(
    ` ${styled("▶", bold, white)} ${styled(name, bold, white)}${" ".repeat(Math.max(1, termWidth - name.length - elapsed.length - 4))}${styled(elapsed, dim)}`,
  );

  const wsStatus = state.workspaces.find((w) => w.id === workspace);
  const feedEntry = state.feed.findLast((f) => f.workspace === workspace);
  const subtitle = wsStatus?.description ?? feedEntry?.promptPreview;
  if (subtitle) {
    lines.push(`   ${styled(truncate(subtitle, termWidth - 4), dim)}`);
  }

  // Show recent tool calls
  if (tools.length > 0) {
    const available = Math.floor((maxLines - lines.length) * 0.6);
    const start = Math.max(0, tools.length - available);
    for (let i = start; i < tools.length; i++) {
      lines.push(formatToolLine(tools[i]!, termWidth));
    }
  }

  // Show assistant text output
  if (output) {
    const outputLines = output.split("\n").filter((l) => l.trim());
    const available = maxLines - lines.length;
    const start = Math.max(0, outputLines.length - available);
    for (let i = start; i < outputLines.length; i++) {
      lines.push(`   ${truncate(outputLines[i]!, termWidth - 4)}`);
    }
  }

  return lines;
}

function renderFeedEntry(entry: FeedEntry, termWidth: number): string[] {
  const name = entry.name;
  const dur = entry.durationMs != null ? prettyMs(entry.durationMs) : "";
  const tools =
    entry.toolCount > 0
      ? styled(`${entry.toolCount} tool${entry.toolCount !== 1 ? "s" : ""}`, dim)
      : "";

  if (entry.outcome === "ok") {
    const meta = [outcomeLabel("ok"), tools, styled(dur, dim)].filter(Boolean).join("  ");
    return [
      ` ${outcomeIcon("ok")} ${styled(name, dim)}${" ".repeat(Math.max(1, termWidth - name.length - visualWidth(meta) - 4))}${meta}`,
    ];
  }

  const icon = outcomeIcon(entry.outcome);
  const label = entry.outcome ? outcomeLabel(entry.outcome) : "";
  const lines: string[] = [];
  const meta = [label, tools, styled(dur, dim)].filter(Boolean).join("  ");
  lines.push(
    ` ${icon} ${styled(name, bold, white)}${" ".repeat(Math.max(1, termWidth - name.length - visualWidth(meta) - 4))}${meta}`,
  );

  const subtitle = entry.description ?? entry.promptPreview;
  if (subtitle) {
    lines.push(`   ${styled(truncate(subtitle, termWidth - 4), dim)}`);
  }

  const detail = entry.output || entry.error;
  if (detail) {
    for (const line of detail.split("\n").slice(0, 3)) {
      lines.push(`   ${truncate(line, termWidth - 4)}`);
    }
  }

  if (entry.outcome === "error") {
    lines.push(`   ${styled("Logs: ~/.murmur/heartbeats.jsonl", dim)}`);
  }

  return lines;
}

// --- State reducer ---

function reduceEvent(state: TuiState, event: DaemonEvent): boolean {
  switch (event.type) {
    case "daemon:ready":
      state.pid = event.pid;
      return false;

    case "tick":
      state.workspaces = event.workspaces;
      return true;

    case "heartbeat:start": {
      state.activeBeat = {
        workspace: event.workspace,
        output: "",
        startedAt: Date.now(),
        tools: [],
      };
      const name = workspaceDisplayName(event.workspace, state.workspaces);
      const wsStatus = state.workspaces.find((w) => w.id === event.workspace);
      state.feed.push({
        workspace: event.workspace,
        name,
        description: wsStatus?.description,
        promptPreview: event.promptPreview,
        outcome: null,
        durationMs: null,
        output: "",
        toolCount: 0,
      });
      return true;
    }

    case "heartbeat:stdout":
      if (state.activeBeat?.workspace === event.workspace) {
        state.activeBeat.output += event.chunk;
      }
      return true;

    case "heartbeat:tool-call":
      if (state.activeBeat?.workspace === event.workspace) {
        state.activeBeat.tools.push(event.toolCall);
      }
      return true;

    case "heartbeat:done": {
      const idx = state.feed.findLastIndex(
        (f) => f.workspace === event.workspace && f.outcome === null,
      );
      if (idx !== -1) {
        const feedEntry = state.feed[idx]!;
        feedEntry.outcome = event.entry.outcome;
        feedEntry.durationMs = event.entry.durationMs;
        feedEntry.error = event.entry.error;
        feedEntry.output =
          state.activeBeat?.workspace === event.workspace ? state.activeBeat.output : "";
        feedEntry.toolCount =
          state.activeBeat?.workspace === event.workspace ? state.activeBeat.tools.length : 0;
      }
      if (state.activeBeat?.workspace === event.workspace) {
        state.activeBeat = null;
      }
      if (state.feed.length > MAX_FEED_ENTRIES)
        state.feed.splice(0, state.feed.length - MAX_FEED_ENTRIES);
      return true;
    }

    case "daemon:shutdown":
      return false;

    default: {
      const _exhaustive: never = event;
      return false;
    }
  }
}

// --- Main TUI ---

export function createTui(eventSource: EventSource, screen?: Screen): Tui {
  const s = screen ?? createScreen();
  const state: TuiState = {
    pid: 0,
    workspaces: [],
    feed: [],
    activeBeat: null,
  };

  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  function render() {
    const termWidth = s.columns();
    const rows = s.rows();

    s.write(cursorHome);

    // Header
    s.write(clearLine + renderHeader(state) + "\n");
    s.write(clearLine + "\n");

    // Workspace rows
    for (const ws of state.workspaces) {
      const active = state.activeBeat?.workspace === ws.id;
      s.write(clearLine + renderWorkspaceRow(ws, active, termWidth) + "\n");
    }

    if (state.workspaces.length === 0) {
      s.write(clearLine + styled(" No workspaces configured.", dim) + "\n");
      s.write(clearLine + styled(` Add one to config.json or run: murmur init <path>`, dim) + "\n");
    }

    s.write(clearLine + "\n");
    s.write(clearLine + renderSeparator(termWidth) + "\n");
    s.write(clearLine + "\n");

    // Fixed region height: header(1) + blank(1) + workspaces(N) + blank(1) + sep(1) + blank(1)
    const fixedLines = 5 + Math.max(state.workspaces.length, 2);
    const feedArea = rows - fixedLines;

    // Render active beat
    const beatLines = renderActiveBeat(state, termWidth, Math.floor(feedArea * 0.6));
    for (const line of beatLines) {
      s.write(clearLine + line + "\n");
    }
    if (beatLines.length > 0) s.write(clearLine + "\n");

    // Render completed feed entries (most recent first, fill remaining space)
    const feedSpace = feedArea - beatLines.length - (beatLines.length > 0 ? 1 : 0);

    if (state.feed.length === 0 && !state.activeBeat) {
      s.write(clearLine + styled(" Waiting for first heartbeat...", dim) + "\n");
    } else {
      let linesUsed = 0;
      for (let i = state.feed.length - 1; i >= 0 && linesUsed < feedSpace; i--) {
        const entry = state.feed[i]!;
        // Skip in-progress entries — already shown in the active beat section
        if (entry.outcome === null && state.activeBeat?.workspace === entry.workspace) continue;
        const entryLines = renderFeedEntry(entry, termWidth);
        if (linesUsed + entryLines.length > feedSpace) break;
        for (const line of entryLines) {
          s.write(clearLine + line + "\n");
          linesUsed++;
        }
      }
    }

    s.write(clearToEnd);
  }

  function handleEvent(event: DaemonEvent) {
    const shouldRender = reduceEvent(state, event);
    if (shouldRender) render();
  }

  return {
    start() {
      s.write(altScreenOn + cursorHide);
      eventSource.subscribe(handleEvent);

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
      s.write(cursorShow + altScreenOff);
    },
  };
}
