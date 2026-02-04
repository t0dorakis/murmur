import { mkdirSync, readFileSync as nodeReadFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Cron, Either } from "effect";
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

export const SOCKET_FILENAME = "murmur.sock";

export function getSocketPath() {
  return join(dataDir, SOCKET_FILENAME);
}

export function ensureDataDir(): void {
  mkdirSync(dataDir, { recursive: true });
}

export function validateWorkspace(ws: WorkspaceConfig): string | null {
  const hasInterval = typeof ws.interval === "string" && ws.interval.length > 0;
  const hasCron = typeof ws.cron === "string" && ws.cron.length > 0;

  if (hasInterval && hasCron) return `has both "interval" and "cron" — pick one`;
  if (!hasInterval && !hasCron) return `missing "interval" or "cron"`;

  if (hasInterval) {
    try {
      parseInterval(ws.interval!);
    } catch {
      return `invalid interval: "${ws.interval}"`;
    }
  }

  if (hasCron) {
    const result = Cron.parse(ws.cron!);
    if (Either.isLeft(result)) return `invalid cron: "${ws.cron}"`;
  }

  if (ws.tz && !hasCron) return `"tz" is only valid with "cron"`;

  return null;
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
    const valid: WorkspaceConfig[] = [];
    for (const ws of parsed.workspaces) {
      const error = validateWorkspace(ws);
      if (error) {
        console.error(`Skipping workspace ${ws.path ?? "(no path)"}: ${error}`);
      } else {
        valid.push(ws);
      }
    }
    return { workspaces: valid };
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

export async function updateLastRun(workspacePath: string, lastRun: string): Promise<void> {
  const config = readConfig();
  const ws = config.workspaces.find((w) => w.path === workspacePath);
  if (ws) {
    ws.lastRun = lastRun;
    await writeConfig(config);
  }
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

export function cleanupRuntimeFiles(): void {
  try { unlinkSync(getPidPath()); } catch {}
  try { unlinkSync(getSocketPath()); } catch {}
}

function isCronDue(ws: WorkspaceConfig): boolean {
  const parsed = Cron.unsafeParse(ws.cron!, ws.tz);
  if (!ws.lastRun) return true;
  const nextAfterLastRun = Cron.next(parsed, new Date(ws.lastRun));
  return Date.now() >= nextAfterLastRun.getTime();
}

export function isDue(ws: WorkspaceConfig): boolean {
  if (ws.cron) return isCronDue(ws);
  if (!ws.interval) return false;
  if (!ws.lastRun) return true;
  const lastRunTime = new Date(ws.lastRun).getTime();
  if (Number.isNaN(lastRunTime)) {
    console.error(`Invalid lastRun timestamp for ${ws.path}: "${ws.lastRun}". Treating as due.`);
    return true;
  }
  const elapsed = Date.now() - lastRunTime;
  return elapsed >= parseInterval(ws.interval);
}

export function nextRunAt(ws: WorkspaceConfig): number {
  if (ws.cron) {
    const parsed = Cron.unsafeParse(ws.cron, ws.tz);
    const from = ws.lastRun ? new Date(ws.lastRun) : new Date();
    return Cron.next(parsed, from).getTime();
  }
  if (!ws.interval) return Date.now();
  const intervalMs = parseInterval(ws.interval);
  const lastRunAt = ws.lastRun ? new Date(ws.lastRun).getTime() : null;
  return lastRunAt ? lastRunAt + intervalMs : Date.now();
}
