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

export type LogEntry = {
  ts: string;
  workspace: string;
  outcome: Outcome;
  durationMs: number;
  summary?: string;
  error?: string;
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
  | { type: "heartbeat:done"; workspace: string; entry: LogEntry }
  | { type: "daemon:ready"; pid: number; workspaceCount: number }
  | { type: "daemon:shutdown" };
