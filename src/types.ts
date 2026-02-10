export type PermissionsConfig = {
  deny?: string[];
};

/** "skip" restores naked --dangerously-skip-permissions behavior (no deny list). */
export type PermissionsOption = PermissionsConfig | "skip";

/**
 * Base configuration shared by all agents.
 */
type BaseWorkspaceConfig = {
  path: string;
  interval?: string;
  cron?: string;
  tz?: string;
  timeout?: string;
  maxTurns?: number;
  permissions?: PermissionsOption;
  name?: string;
  description?: string;
  model?: string;
  session?: string;
  lastRun: string | null;
  /** Relative path to the HEARTBEAT.md file (e.g. "heartbeats/issue-worker/HEARTBEAT.md"). */
  heartbeatFile?: string;
  /** Per-heartbeat last-run timestamps for multi-heartbeat workspaces. */
  lastRuns?: Record<string, string>;
};

/**
 * Claude Code-specific configuration.
 */
type ClaudeCodeConfig = BaseWorkspaceConfig & {
  agent?: "claude-code";
};

/**
 * Pi agent-specific configuration.
 */
export type PiConfig = BaseWorkspaceConfig & {
  agent: "pi";
};

/**
 * OpenAI Codex CLI-specific configuration.
 */
export type CodexConfig = BaseWorkspaceConfig & {
  agent: "codex";
  /** Codex sandbox mode: "workspace-write" (default), "read-only", or "danger-full-access" */
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  /** Enable outbound network access (only applies to workspace-write sandbox). Default: false */
  networkAccess?: boolean;
};

/**
 * Generic agent configuration (for future/unknown agents).
 */
type GenericAgentConfig = BaseWorkspaceConfig & {
  agent: string;
  // Allow any additional properties for future agents
  [key: string]: unknown;
};

/**
 * Workspace configuration supporting multiple agent harnesses.
 * Uses discriminated union based on the 'agent' field for type safety.
 */
export type WorkspaceConfig = ClaudeCodeConfig | PiConfig | CodexConfig | GenericAgentConfig;

export type Config = {
  workspaces: WorkspaceConfig[];
};

export type Outcome = "ok" | "attention" | "error" | "lost" | "recovered";

/** A tool call extracted from an agent's structured output. */
export type ToolCall = {
  name: string;
  input: Record<string, unknown>;
  output?: string;
  durationMs?: number;
};

/** A single turn in the agent conversation. */
export type ConversationTurn =
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[] }
  | {
      role: "result";
      text: string;
      costUsd?: number;
      durationMs?: number;
      numTurns?: number;
    };

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
  id: string;
  path: string;
  name: string;
  description?: string;
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
