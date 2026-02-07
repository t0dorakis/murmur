import { parseInterval } from "../config.ts";
import type { WorkspaceConfig } from "../types.ts";

/**
 * Default timeout for agent execution (5 minutes).
 */
export const DEFAULT_AGENT_TIMEOUT_MS = 300_000;

/**
 * Default maximum number of agent turns per heartbeat.
 */
export const DEFAULT_MAX_TURNS = 99;

/** Resolve workspace timeout to milliseconds, falling back to the 5m default. */
export function resolveTimeoutMs(ws: WorkspaceConfig): number {
  return ws.timeout ? parseInterval(ws.timeout) : DEFAULT_AGENT_TIMEOUT_MS;
}
