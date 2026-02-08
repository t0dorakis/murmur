import { readdirSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { debug } from "./debug.ts";
import type { WorkspaceConfig } from "./types.ts";

export const HEARTBEATS_DIR = "heartbeats";
export const HEARTBEAT_FILENAME = "HEARTBEAT.md";

/** Check whether a workspace config refers to the root HEARTBEAT.md (or has no heartbeatFile set). */
export function isRootHeartbeat(ws: WorkspaceConfig): boolean {
  return !ws.heartbeatFile || ws.heartbeatFile === HEARTBEAT_FILENAME;
}

const VALID_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/** Build the relative path for a named heartbeat: `heartbeats/<name>/HEARTBEAT.md`. */
export function namedHeartbeatFile(name: string): string {
  if (!name || !VALID_NAME_RE.test(name)) {
    throw new Error(
      `Invalid heartbeat name "${name}". Use only alphanumeric characters, hyphens, and underscores.`,
    );
  }
  return join(HEARTBEATS_DIR, name, HEARTBEAT_FILENAME);
}

/**
 * Canonical identifier for a heartbeat within a workspace.
 * Returns `ws.path` for single/root heartbeats (backward compat),
 * or `path::heartbeatFile` for multi-heartbeat entries.
 */
export function heartbeatId(ws: WorkspaceConfig): string {
  if (isRootHeartbeat(ws)) {
    return ws.path;
  }
  return `${ws.path}::${ws.heartbeatFile}`;
}

/**
 * Human-readable display name for a heartbeat.
 * Returns `basename(path)` for root heartbeats,
 * or `basename(path)/heartbeatName` for heartbeats in the heartbeats/ dir.
 */
export function heartbeatDisplayName(ws: WorkspaceConfig): string {
  const base = basename(ws.path);
  if (isRootHeartbeat(ws)) {
    return base;
  }
  // heartbeatFile is like "heartbeats/issue-worker/HEARTBEAT.md"
  const heartbeatDir = dirname(ws.heartbeatFile!);
  const heartbeatName = basename(heartbeatDir);
  return `${base}/${heartbeatName}`;
}

/**
 * Absolute path to the HEARTBEAT.md file for this workspace config.
 */
export function heartbeatFilePath(ws: Pick<WorkspaceConfig, "path" | "heartbeatFile">): string {
  return join(ws.path, ws.heartbeatFile ?? HEARTBEAT_FILENAME);
}

/**
 * Discover all heartbeat files in a workspace directory.
 * Returns relative paths from the workspace root.
 *
 * Checks:
 * 1. Root HEARTBEAT.md
 * 2. heartbeats/<name>/HEARTBEAT.md directories
 */
export function discoverHeartbeats(wsPath: string): string[] {
  const found: string[] = [];

  // Check root HEARTBEAT.md
  if (existsSync(join(wsPath, HEARTBEAT_FILENAME))) {
    found.push(HEARTBEAT_FILENAME);
  }

  // Check heartbeats/ directory
  const heartbeatsDir = join(wsPath, HEARTBEATS_DIR);
  if (existsSync(heartbeatsDir)) {
    try {
      const entries = readdirSync(heartbeatsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const hbPath = join(HEARTBEATS_DIR, entry.name, HEARTBEAT_FILENAME);
          if (existsSync(join(wsPath, hbPath))) {
            found.push(hbPath);
          }
        }
      }
    } catch (err: any) {
      // ENOENT can happen if the directory is removed between existsSync and readdirSync
      if (err?.code === "ENOENT") {
        debug(`Warning: ${heartbeatsDir} was removed during discovery`);
      } else {
        // Permission errors and I/O failures should be visible
        console.error(`Error reading ${heartbeatsDir}: ${err?.message}`);
      }
    }
  }

  return found;
}

/**
 * Expand a single workspace config entry into N entries — one per discovered heartbeat.
 * For workspaces with only a root HEARTBEAT.md, returns the original entry unchanged.
 * For multi-heartbeat workspaces, sets `heartbeatFile` and resolves `lastRun` from `lastRuns` map.
 */
export function expandWorkspace(ws: WorkspaceConfig): WorkspaceConfig[] {
  const heartbeats = discoverHeartbeats(ws.path);

  if (heartbeats.length === 0) {
    debug(`  ${ws.path}: no heartbeats discovered`);
    return [ws];
  }

  // Single root heartbeat with no lastRuns map — return as-is (backward compat).
  // The !ws.lastRuns guard ensures expansion still occurs when lastRuns exists,
  // so each expanded entry gets its heartbeatFile set correctly.
  if (heartbeats.length === 1 && heartbeats[0] === HEARTBEAT_FILENAME && !ws.lastRuns) {
    return [ws];
  }

  return heartbeats.map((hbFile) => {
    const lastRun = resolveLastRun(ws, hbFile);
    return {
      ...ws,
      heartbeatFile: hbFile,
      lastRun,
    };
  });
}

/**
 * Resolve the lastRun timestamp for a specific heartbeat file.
 * Checks `lastRuns[heartbeatFile]` first, falls back to flat `lastRun` for root HEARTBEAT.md.
 */
function resolveLastRun(ws: WorkspaceConfig, heartbeatFile: string): string | null {
  // Check lastRuns map first (use != null to catch empty strings, letting parseLastRun handle validation)
  if (ws.lastRuns?.[heartbeatFile] != null) {
    return ws.lastRuns[heartbeatFile];
  }
  // Fall back to flat lastRun for root heartbeat only
  if (heartbeatFile === HEARTBEAT_FILENAME) {
    return ws.lastRun;
  }
  return null;
}
