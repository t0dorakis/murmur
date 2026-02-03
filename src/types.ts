export type WorkspaceConfig = {
  path: string;
  interval: string;
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
