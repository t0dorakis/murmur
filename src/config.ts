import { mkdirSync, readFileSync as nodeReadFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Cron, Either } from "effect";
import { debug } from "./debug.ts";
import { validatePermissions } from "./permissions.ts";
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

/**
 * Validate a workspace entry from config.json.
 * Schedule is optional here — it may come from HEARTBEAT.md frontmatter.
 */
export function validateWorkspace(ws: WorkspaceConfig): string | null {
  const hasInterval = typeof ws.interval === "string" && ws.interval.length > 0;
  const hasCron = typeof ws.cron === "string" && ws.cron.length > 0;

  if (hasInterval && hasCron) return `has both "interval" and "cron" — pick one`;

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

  if (ws.tz) {
    try {
      const supported = Intl.supportedValuesOf("timeZone");
      if (!supported.includes(ws.tz)) return `invalid timezone: "${ws.tz}"`;
    } catch {
      // Intl.supportedValuesOf not available — skip validation
    }
  }

  if (ws.timeout) {
    try {
      parseInterval(ws.timeout);
    } catch {
      return `invalid timeout: "${ws.timeout}"`;
    }
  }

  const permError = validatePermissions(ws.permissions);
  if (permError) return permError;

  return null;
}

/**
 * Validate a resolved workspace config (after merging frontmatter).
 * A schedule (interval or cron) is required at this point.
 */
export function validateResolvedConfig(ws: WorkspaceConfig): string | null {
  const base = validateWorkspace(ws);
  if (base) return base;

  const hasInterval = typeof ws.interval === "string" && ws.interval.length > 0;
  const hasCron = typeof ws.cron === "string" && ws.cron.length > 0;
  if (!hasInterval && !hasCron)
    return `missing "interval" or "cron" (set in HEARTBEAT.md frontmatter or config.json)`;

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
    debug(`Config loaded: ${valid.length} workspace(s) from ${configPath}`);
    for (const ws of valid) {
      const schedule = ws.interval
        ? `interval=${ws.interval}`
        : `cron="${ws.cron}"${ws.tz ? ` tz=${ws.tz}` : ""}`;
      debug(`  Workspace: ${ws.path} (${schedule}, lastRun=${ws.lastRun ?? "never"})`);
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
  if (!ws) {
    console.error(`Warning: workspace ${workspacePath} not found in config during lastRun update`);
    return;
  }
  ws.lastRun = lastRun;
  await writeConfig(config);
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
  const ms = value * multipliers[unit]!;
  debug(`Parsed interval "${s}" → ${ms}ms`);
  return ms;
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.error(`Warning: could not remove ${path}: ${err?.message}`);
    }
  }
}

export function cleanupRuntimeFiles(): void {
  tryUnlink(getPidPath());
  tryUnlink(getSocketPath());
}

function parseLastRun(ws: WorkspaceConfig): number | null {
  if (!ws.lastRun) return null;
  const t = new Date(ws.lastRun).getTime();
  if (Number.isNaN(t)) {
    console.error(
      `Invalid lastRun timestamp for ${ws.path}: "${ws.lastRun}". Treating as never run.`,
    );
    return null;
  }
  return t;
}

function nextCronRunAt(ws: WorkspaceConfig): number {
  const parsed = Cron.unsafeParse(ws.cron!, ws.tz);
  const lastRunAt = parseLastRun(ws);
  const from = lastRunAt != null ? new Date(lastRunAt) : new Date();
  return Cron.next(parsed, from).getTime();
}

export function isDue(ws: WorkspaceConfig): boolean {
  if (ws.cron) {
    if (!parseLastRun(ws)) return true;
    return Date.now() >= nextCronRunAt(ws);
  }
  if (!ws.interval) return false;
  const lastRunAt = parseLastRun(ws);
  if (lastRunAt == null) return true;
  return Date.now() - lastRunAt >= parseInterval(ws.interval);
}

export function nextRunAt(ws: WorkspaceConfig): number {
  if (ws.cron) return nextCronRunAt(ws);
  if (!ws.interval) return Date.now();
  const intervalMs = parseInterval(ws.interval);
  const lastRunAt = parseLastRun(ws);
  return lastRunAt != null ? lastRunAt + intervalMs : Date.now();
}
