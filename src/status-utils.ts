import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getLogPath } from "./config.ts";
import { debug } from "./debug.ts";
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
 * Read heartbeats.jsonl lines in reverse order, parsing each as a LogEntry.
 * Skips malformed lines with a debug log. Returns entries newest-first.
 * The log is assumed to be in chronological append order.
 */
function readLogEntriesReverse(): LogEntry[] {
  const logPath = getLogPath();
  if (!existsSync(logPath)) return [];

  let lines: string[];
  try {
    const content = readFileSync(logPath, "utf-8");
    lines = content.trim().split("\n").filter(Boolean);
  } catch (err: any) {
    debug(`Warning: could not read ${logPath}: ${err?.message}`);
    return [];
  }

  const entries: LogEntry[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      entries.push(JSON.parse(lines[i]!));
    } catch {
      debug(`Skipping malformed log line ${i + 1}`);
    }
  }
  return entries;
}

/**
 * Read recent error/attention entries from heartbeats.jsonl.
 * Returns the last `limit` non-ok entries within `withinMs` milliseconds.
 */
export function readRecentErrors(limit = 5, withinMs = 86_400_000): LogEntry[] {
  const cutoff = Date.now() - withinMs;
  const errors: LogEntry[] = [];

  for (const entry of readLogEntriesReverse()) {
    if (errors.length >= limit) break;
    const entryTime = new Date(entry.ts).getTime();
    // Log is chronological; once we hit an entry older than cutoff, stop
    if (entryTime < cutoff) break;
    if (entry.outcome !== "ok") errors.push(entry);
  }

  return errors;
}

/**
 * Get the last log entry for a workspace path.
 */
export function getLastOutcome(wsPath: string): { outcome: Outcome; ts: string } | null {
  for (const entry of readLogEntriesReverse()) {
    if (entry.workspace === wsPath) {
      return { outcome: entry.outcome, ts: entry.ts };
    }
  }
  return null;
}
