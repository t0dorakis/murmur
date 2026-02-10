import { renameSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getDataDir, ensureDataDir } from "./config.ts";
import { debug } from "./debug.ts";

export type ActiveBeat = {
  pid: number;
  startedAt: string;
  workspace: string;
};

export type ActiveBeatsMap = Record<string, ActiveBeat>;

export const ACTIVE_BEATS_FILENAME = "active-beats.json";

export function getActiveBeatsPath(): string {
  return join(getDataDir(), ACTIVE_BEATS_FILENAME);
}

/**
 * Read active-beats.json. Returns empty object if file doesn't exist or is corrupt.
 */
export function readActiveBeats(): ActiveBeatsMap {
  const path = getActiveBeatsPath();
  if (!existsSync(path)) return {};

  try {
    const content = readFileSync(path, "utf-8");
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      debug(`Active beats file is corrupt (not an object). Treating as empty.`);
      return {};
    }
    return parsed as ActiveBeatsMap;
  } catch (err: any) {
    debug(`Failed to read active-beats.json: ${err?.message}. Treating as empty.`);
    return {};
  }
}

/**
 * Write active-beats.json atomically (write to .tmp then rename).
 */
async function writeActiveBeats(beats: ActiveBeatsMap): Promise<void> {
  ensureDataDir();
  const path = getActiveBeatsPath();
  const tmp = path + ".tmp";
  await Bun.write(tmp, JSON.stringify(beats, null, 2) + "\n");
  renameSync(tmp, path);
}

/**
 * Record a heartbeat as active. Call this immediately after spawning the agent process.
 */
export async function recordActiveBeat(id: string, pid: number, workspace: string): Promise<void> {
  const beats = readActiveBeats();
  beats[id] = {
    pid,
    startedAt: new Date().toISOString(),
    workspace,
  };
  await writeActiveBeats(beats);
  debug(`[active-beats] Recorded: ${id} (PID ${pid})`);
}

/**
 * Remove a heartbeat from the active list. Call this when the heartbeat completes.
 */
export async function removeActiveBeat(id: string): Promise<void> {
  const beats = readActiveBeats();
  if (!beats[id]) {
    debug(`[active-beats] Warning: attempted to remove non-existent beat ${id}`);
    return;
  }
  delete beats[id];
  await writeActiveBeats(beats);
  debug(`[active-beats] Removed: ${id}`);
}

/**
 * Clear all active beats. Call this after recovery or on daemon shutdown.
 */
export async function clearActiveBeats(): Promise<void> {
  const path = getActiveBeatsPath();
  try {
    unlinkSync(path);
    debug(`[active-beats] Cleared active-beats.json`);
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      debug(`[active-beats] Warning: could not remove ${path}: ${err?.message}`);
    }
  }
}
