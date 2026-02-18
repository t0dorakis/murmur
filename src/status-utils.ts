import { existsSync, readFileSync } from "node:fs";
import prettyMs from "pretty-ms";
import { getLogPath, parseLastRun, readConfig, validateResolvedConfig } from "./config.ts";
import { debug } from "./debug.ts";
import { readPid, isProcessAlive } from "./process-utils.ts";
import {
  expandWorkspace,
  heartbeatDisplayName,
  heartbeatFilePath,
  heartbeatId,
} from "./discovery.ts";
import { resolveWorkspaceConfig } from "./frontmatter.ts";
import { icons } from "./ansi.ts";
import type { LogEntry, Outcome, WorkspaceConfig } from "./types.ts";

export type WorkspaceHealth = {
  pathExists: boolean;
  heartbeatExists: boolean;
};

/**
 * Validate a workspace path: check directory exists and HEARTBEAT.md is present.
 */
export function checkWorkspaceHealth(
  ws: Pick<WorkspaceConfig, "path" | "heartbeatFile">,
): WorkspaceHealth {
  const pathExists = existsSync(ws.path);
  const heartbeatExists = pathExists && existsSync(heartbeatFilePath(ws));
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
 * Get the last log entry for a workspace (matched by heartbeat ID).
 */
export function getLastOutcome(id: string): { outcome: Outcome; ts: string } | null {
  for (const entry of readLogEntriesReverse()) {
    if (entry.workspace === id) {
      return { outcome: entry.outcome, ts: entry.ts };
    }
  }
  return null;
}

// --- Status display ---

function formatElapsed(isoDate: string): string {
  const t = new Date(isoDate).getTime();
  if (Number.isNaN(t)) return "invalid timestamp";
  const diff = Date.now() - t;
  return diff > 0 ? `${prettyMs(diff, { compact: true })} ago` : "just now";
}

/**
 * Print full `murmur status` output to stdout.
 */
export function printStatus() {
  const pid = readPid();
  const alive = pid ? isProcessAlive(pid) : false;

  if (alive) {
    console.log(`Daemon: running (PID ${pid})`);
  } else {
    console.log("Daemon: stopped");
  }

  const config = readConfig();
  if (config.workspaces.length === 0) {
    console.log(`\nNo workspaces configured. Run: murmur init <path>`);
    return;
  }

  // Expand multi-heartbeat workspaces
  const expanded = config.workspaces.flatMap(expandWorkspace);

  let validCount = 0;
  let issueCount = 0;

  const rows = expanded.map((ws) => {
    try {
      const health = checkWorkspaceHealth(ws);
      const resolved = resolveWorkspaceConfig(ws);
      const configError = validateResolvedConfig(resolved);

      let issue: string | undefined;
      if (!health.pathExists) {
        issue = "path does not exist";
      } else if (!health.heartbeatExists) {
        issue = "HEARTBEAT.md missing";
      } else if (configError) {
        issue = configError;
      }

      if (issue) {
        issueCount++;
      } else {
        validCount++;
      }

      const statusIcon = issue ? icons.fail : icons.ok;
      const name = resolved.name ?? heartbeatDisplayName(ws);
      const schedule = resolved.interval
        ? `every ${resolved.interval}`
        : resolved.cron
          ? `cron ${resolved.cron}`
          : "(none)";

      let statusMsg: string;
      if (issue) {
        statusMsg = issue;
      } else {
        const lastRunAt = parseLastRun(ws);
        if (lastRunAt == null) {
          statusMsg = "never run";
        } else {
          const ago = formatElapsed(new Date(lastRunAt).toISOString());
          const id = heartbeatId(ws);
          const lastOutcome = getLastOutcome(id);
          const outcomeTag = lastOutcome ? ` (${lastOutcome.outcome})` : "";
          statusMsg = `last: ${ago}${outcomeTag}`;
        }
      }

      return { statusIcon, name, schedule, statusMsg, id: heartbeatId(ws) };
    } catch {
      issueCount++;
      return {
        statusIcon: icons.fail,
        name: heartbeatDisplayName(ws),
        schedule: "(unknown)",
        statusMsg: "config error",
        id: heartbeatId(ws),
      };
    }
  });

  const nameW = Math.max(...rows.map((r) => r.name.length));
  const schedW = Math.max(...rows.map((r) => r.schedule.length));
  const statusW = Math.max(...rows.map((r) => r.statusMsg.length));

  const summary =
    issueCount > 0
      ? `${validCount} valid, ${issueCount} ${issueCount === 1 ? "issue" : "issues"}`
      : `${validCount}`;
  console.log(`\nHeartbeats (${summary}):`);

  for (const r of rows) {
    const nameCol = r.name.padEnd(nameW);
    const schedCol = r.schedule.padEnd(schedW);
    const statusCol = r.statusMsg.padEnd(statusW);
    console.log(`  ${r.statusIcon} ${nameCol}  ${schedCol}  ${statusCol}  ${r.id}`);
  }

  // Recent issues from heartbeat log
  const nameById = new Map(rows.map((r) => [r.id, r.name]));
  const errors = readRecentErrors(5);
  if (errors.length > 0) {
    console.log(`\nRecent issues (last 24h):`);
    for (const entry of errors) {
      const elapsed = Date.now() - new Date(entry.ts).getTime();
      const time =
        Number.isNaN(elapsed) || elapsed < 0
          ? "just now"
          : `${prettyMs(elapsed, { compact: true })} ago`;
      const msg =
        entry.outcome === "error"
          ? (entry.error ?? "unknown error")
          : (entry.summary ?? "needs attention");
      const wsName = nameById.get(entry.workspace) ?? entry.workspace;
      console.log(`  ${icons.bullet} ${time} ${wsName}: ${msg}`);
    }
  }
}
