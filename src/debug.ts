import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir, ensureDataDir } from "./config.ts";

let enabled = false;

export const DEBUG_LOG_FILENAME = "debug.log";

export function enableDebug(): void {
  enabled = true;
  ensureDataDir();
}

export function isDebugEnabled(): boolean {
  return enabled;
}

export function debug(message: string): void {
  if (!enabled) return;
  try {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    appendFileSync(join(getDataDir(), DEBUG_LOG_FILENAME), line);
  } catch (err) {
    console.error(`[debug] failed to write log: ${err}`);
  }
}

export function getDebugLogPath(): string {
  return join(getDataDir(), DEBUG_LOG_FILENAME);
}

/** Truncate a string for debug logging, adding ellipsis if truncated. */
export function truncateForLog(text: string, maxLen = 100): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}
