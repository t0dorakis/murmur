import { mkdirSync, readFileSync as nodeReadFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config, WorkspaceConfig } from "./types.ts";

let dataDir = join(homedir(), ".murmur");

export function setDataDir(dir: string) {
  dataDir = dir;
}

export function getDataDir() {
  return dataDir;
}

export function getConfigPath() {
  return join(dataDir, "config.json");
}

export function ensureDataDir(): void {
  mkdirSync(dataDir, { recursive: true });
}

export function readConfig(): Config {
  const configPath = getConfigPath();
  try {
    const text = nodeReadFileSync(configPath, "utf-8");
    return JSON.parse(text) as Config;
  } catch {
    return { workspaces: [] };
  }
}

export async function writeConfig(config: Config): Promise<void> {
  ensureDataDir();
  const configPath = getConfigPath();
  const tmp = configPath + ".tmp";
  await Bun.write(tmp, JSON.stringify(config, null, 2) + "\n");
  renameSync(tmp, configPath);
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
