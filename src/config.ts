import { mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config, WorkspaceConfig } from "./types.ts";

const DATA_DIR = join(homedir(), ".orchester");
const CONFIG_PATH = join(DATA_DIR, "config.json");

export { DATA_DIR, CONFIG_PATH };

export function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}

export function readConfig(): Config {
  const file = Bun.file(CONFIG_PATH);
  if (!file.size) return { workspaces: [] };
  // Synchronous read via textSync not available; use a blocking pattern
  const text = readFileSync(CONFIG_PATH);
  return JSON.parse(text) as Config;
}

// Separate sync reader since Bun.file is async
import { readFileSync as nodeReadFileSync } from "node:fs";
function readFileSync(path: string): string {
  try {
    return nodeReadFileSync(path, "utf-8");
  } catch {
    return '{"workspaces":[]}';
  }
}

export async function writeConfig(config: Config): Promise<void> {
  ensureDataDir();
  const tmp = CONFIG_PATH + ".tmp";
  await Bun.write(tmp, JSON.stringify(config, null, 2) + "\n");
  renameSync(tmp, CONFIG_PATH);
}

const INTERVAL_RE = /^(\d+)(s|m|h|d)$/;

export function parseInterval(s: string): number {
  const match = INTERVAL_RE.exec(s);
  if (!match) throw new Error(`Invalid interval: "${s}". Use e.g. "30m", "1h", "15m".`);
  const value = Number(match[1]!);
  const unit = match[2]!;
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * multipliers[unit]!;
}

export function isDue(ws: WorkspaceConfig): boolean {
  if (!ws.lastRun) return true;
  const elapsed = Date.now() - new Date(ws.lastRun).getTime();
  return elapsed >= parseInterval(ws.interval);
}
