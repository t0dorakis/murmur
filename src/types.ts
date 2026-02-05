export type WorkspaceConfig = {
  path: string;
  interval?: string;
  cron?: string;
  tz?: string;
  maxTurns?: number;
  lastRun: string | null;
};

export type Config = {
  workspaces: WorkspaceConfig[];
};

export type Outcome = "ok" | "attention" | "error";

/** A tool call extracted from Claude's stream-json output. */
export type ToolCall = {
  name: string;
  input: Record<string, unknown>;
  output?: string;
  durationMs?: number;
};

/** A single turn in the agent conversation. */
export type ConversationTurn =
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[] }
  | { role: "result"; text: string; costUsd?: number; durationMs?: number; numTurns?: number };

export type LogEntry = {
  ts: string;
  workspace: string;
  outcome: Outcome;
  durationMs: number;
  summary?: string;
  error?: string;
  /** Conversation turns captured when running in verbose mode. */
  turns?: ConversationTurn[];
};

export type WorkspaceStatus = {
  path: string;
  name: string;
  schedule: string;
  scheduleType: "interval" | "cron";
  nextRunAt: number;
  lastOutcome: Outcome | null;
  lastRunAt: number | null;
};

export type DaemonEvent =
  | { type: "tick"; workspaces: WorkspaceStatus[] }
  | { type: "heartbeat:start"; workspace: string; promptPreview: string }
  | { type: "heartbeat:stdout"; workspace: string; chunk: string }
  | { type: "heartbeat:tool-call"; workspace: string; toolCall: ToolCall }
  | { type: "heartbeat:done"; workspace: string; entry: LogEntry }
  | { type: "daemon:ready"; pid: number; workspaceCount: number }
  | { type: "daemon:shutdown" };
