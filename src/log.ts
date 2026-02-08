import { appendFileSync } from "node:fs";
import { ensureDataDir, getLogPath } from "./config.ts";
import type { LogEntry } from "./types.ts";

export function appendLog(entry: LogEntry): void {
  ensureDataDir();
  appendFileSync(getLogPath(), JSON.stringify(entry) + "\n");
}
