import { readFileSync } from "node:fs";
import { getPidPath } from "./config.ts";

/**
 * Check if a process with the given PID is alive.
 * Uses process.kill(pid, 0) which doesn't actually send a signal,
 * but returns an error if the process doesn't exist.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM means process exists but we don't have permission to signal it
    if (err?.code === "EPERM") return true;
    return false;
  }
}

/**
 * Read the daemon PID from the PID file.
 * Returns null if the file doesn't exist or contains invalid data.
 */
export function readPid(): number | null {
  try {
    const raw = readFileSync(getPidPath(), "utf-8").trim();
    const pid = Number(raw);
    if (Number.isNaN(pid)) {
      console.error(`Corrupt PID file (content: "${raw}"). Ignoring.`);
      return null;
    }
    return pid;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Kill a process with the given signal (default: SIGTERM).
 * Returns true if the signal was sent successfully.
 */
export function killProcess(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}
