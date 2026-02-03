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

export const PID_FILENAME = "murmur.pid";

export function getPidPath() {
  return join(dataDir, PID_FILENAME);
}

export function ensureDataDir(): void {
  mkdirSync(dataDir, { recursive: true });
}

export function readConfig(): Config {
  const configPath = getConfigPath();
  try {
    const text = nodeReadFileSync(configPath, "utf-8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed?.workspaces)) {
      console.error(`Invalid config: "workspaces" must be an array in ${configPath}`);
      return { workspaces: [] };
    }
    return parsed as Config;
  } catch (err: any) {
    if (err?.code === "ENOENT") return { workspaces: [] };
    console.error(`Failed to read config (${configPath}):`, err?.message ?? err);
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
  const lastRunTime = new Date(ws.lastRun).getTime();
  if (Number.isNaN(lastRunTime)) {
    console.error(`Invalid lastRun timestamp for ${ws.path}: "${ws.lastRun}". Treating as due.`);
    return true;
  }
  const elapsed = Date.now() - lastRunTime;
  return elapsed >= parseInterval(ws.interval);
}
