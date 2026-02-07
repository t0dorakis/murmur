import type { WorkspaceConfig, ConversationTurn, ToolCall } from "../types.ts";

/**
 * Result from executing an agent with a prompt.
 */
export type AgentExecutionResult = {
  /** The final text output from the agent */
  resultText: string;
  /** Exit code from the agent process */
  exitCode: number;
  /** Standard error output */
  stderr: string;
  /** Parsed conversation turns (if available) */
  turns?: ConversationTurn[];
  /** Cost in USD (if available) */
  costUsd?: number;
  /** Number of agent turns (if available) */
  numTurns?: number;
  /** Duration in milliseconds */
  durationMs: number;
};

/**
 * Callbacks for streaming agent execution events.
 */
export type AgentStreamCallbacks = {
  onToolCall?: (toolCall: ToolCall) => void;
  onText?: (text: string) => void;
};

/**
 * Abstract interface for AI agent harnesses.
 * Each agent (Claude Code, pi, Aider, etc.) implements this interface.
 */
export interface AgentAdapter {
  /**
   * Name of the agent (e.g., "claude-code", "pi", "aider")
   */
  readonly name: string;

  /**
   * Execute the agent with a given prompt in the workspace.
   *
   * @param prompt The prompt to send to the agent
   * @param workspace The workspace configuration
   * @param callbacks Optional callbacks for streaming events
   * @returns Execution result with output, exit code, and metadata
   */
  execute(
    prompt: string,
    workspace: WorkspaceConfig,
    callbacks?: AgentStreamCallbacks,
  ): Promise<AgentExecutionResult>;

  /**
   * Check if the agent CLI is available on the system.
   * @returns true if the agent can be executed
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the version of the agent (for debugging).
   * @returns version string or null if unavailable
   */
  getVersion(): Promise<string | null>;
}

/**
 * Registry of available agent adapters.
 */
const adapters = new Map<string, AgentAdapter>();

/**
 * Register an agent adapter.
 */
export function registerAdapter(adapter: AgentAdapter): void {
  adapters.set(adapter.name, adapter);
}

/**
 * Get an agent adapter by name.
 * @throws Error if adapter not found
 */
export function getAdapter(name: string): AgentAdapter {
  const adapter = adapters.get(name);
  if (!adapter) {
    const available = Array.from(adapters.keys()).join(", ");
    throw new Error(
      `Agent adapter "${name}" not found. Available: ${available}`,
    );
  }
  return adapter;
}

/**
 * Get all registered agent names.
 */
export function listAdapters(): string[] {
  return Array.from(adapters.keys());
}

/**
 * Check which agents are available on the system.
 */
export async function detectAvailableAgents(): Promise<string[]> {
  const available: string[] = [];
  for (const [name, adapter] of adapters) {
    if (await adapter.isAvailable()) {
      available.push(name);
    }
  }
  return available;
}
