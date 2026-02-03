import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir, ensureDataDir } from "./config.ts";
import type { LogEntry } from "./types.ts";

export function appendLog(entry: LogEntry): void {
  ensureDataDir();
  appendFileSync(join(getDataDir(), "heartbeats.jsonl"), JSON.stringify(entry) + "\n");
}
