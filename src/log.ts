import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, ensureDataDir } from "./config.ts";
import type { LogEntry } from "./types.ts";

const LOG_PATH = join(DATA_DIR, "heartbeats.jsonl");

export function appendLog(entry: LogEntry): void {
  ensureDataDir();
  appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
}
