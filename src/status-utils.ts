import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "./config.ts";
import type { LogEntry, Outcome } from "./types.ts";

export type WorkspaceHealth = {
  pathExists: boolean;
  heartbeatExists: boolean;
};

/**
 * Validate a workspace path: check directory exists and HEARTBEAT.md is present.
 */
export function checkWorkspaceHealth(wsPath: string): WorkspaceHealth {
  const pathExists = existsSync(wsPath);
  const heartbeatExists = pathExists && existsSync(join(wsPath, "HEARTBEAT.md"));
  return { pathExists, heartbeatExists };
}

/**
 * Read recent error/attention entries from heartbeats.jsonl.
 * Returns the last `limit` non-ok entries within `withinMs` milliseconds.
 */
export function readRecentErrors(limit = 5, withinMs = 86_400_000): LogEntry[] {
  const logPath = join(getDataDir(), "heartbeats.jsonl");
  if (!existsSync(logPath)) return [];

  let lines: string[];
  try {
    const content = readFileSync(logPath, "utf-8");
    lines = content.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }

  const cutoff = Date.now() - withinMs;
  const errors: LogEntry[] = [];

  // Read from end for efficiency
  for (let i = lines.length - 1; i >= 0 && errors.length < limit; i--) {
    try {
      const entry: LogEntry = JSON.parse(lines[i]!);
      const entryTime = new Date(entry.ts).getTime();
      if (entryTime < cutoff) break;
      if (entry.outcome !== "ok") errors.push(entry);
    } catch {
      // Skip malformed lines
    }
  }

  return errors;
}

/**
 * Get the last log entry for a workspace path.
 */
export function getLastOutcome(wsPath: string): { outcome: Outcome; ts: string } | null {
  const logPath = join(getDataDir(), "heartbeats.jsonl");
  if (!existsSync(logPath)) return null;

  let lines: string[];
  try {
    const content = readFileSync(logPath, "utf-8");
    lines = content.trim().split("\n").filter(Boolean);
  } catch {
    return null;
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry: LogEntry = JSON.parse(lines[i]!);
      if (entry.workspace === wsPath) {
        return { outcome: entry.outcome, ts: entry.ts };
      }
    } catch {
      // Skip malformed lines
    }
  }

  return null;
}
