import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setDataDir, ensureDataDir, isDue, parseInterval, readConfig, writeConfig, getPidPath, getDataDir } from "./config.ts";
import { createEventBus, type EventBus } from "./events.ts";
import { runHeartbeat } from "./heartbeat.ts";
import { appendLog } from "./log.ts";
import type { WorkspaceConfig, WorkspaceStatus } from "./types.ts";

export const SOCKET_FILENAME = "murmur.sock";

export function getSocketPath() {
  return join(getDataDir(), SOCKET_FILENAME);
}

export function workspaceName(ws: WorkspaceConfig): string {
  try {
    const text = readFileSync(join(ws.path, "HEARTBEAT.md"), "utf-8");
    const match = /^#\s+(.+)/m.exec(text);
    if (match) return match[1]!.trim();
  } catch {}
  return ws.path.split("/").pop() ?? ws.path;
}

export function buildWorkspaceStatuses(workspaces: WorkspaceConfig[]): WorkspaceStatus[] {
  return workspaces.map((ws) => {
    const intervalMs = parseInterval(ws.interval);
    const lastRunAt = ws.lastRun ? new Date(ws.lastRun).getTime() : null;
    const nextRunAt = lastRunAt ? lastRunAt + intervalMs : Date.now();
    return {
      path: ws.path,
      name: workspaceName(ws),
      interval: ws.interval,
      nextRunAt,
      lastOutcome: null,
      lastRunAt,
    };
  });
}

export type DaemonHandle = {
  bus: EventBus;
  stop(): void;
};

/**
 * Start the daemon loop. Returns a handle with the event bus and a stop function.
 * The caller is responsible for PID file management and signal handling.
 */
export function startDaemon(tickMs: number): DaemonHandle {
  const bus = createEventBus();
  let running = true;

  const config = readConfig();
  bus.emit({ type: "daemon:ready", pid: process.pid, workspaceCount: config.workspaces.length });

  (async () => {
    while (running) {
      const config = readConfig();
      bus.emit({ type: "tick", workspaces: buildWorkspaceStatuses(config.workspaces) });

      for (const ws of config.workspaces) {
        if (!running) break;
        if (!isDue(ws)) continue;

        const entry = await runHeartbeat(ws, bus.emit.bind(bus));
        appendLog(entry);

        ws.lastRun = entry.ts;
        await writeConfig(config);
      }

      if (running) await Bun.sleep(tickMs);
    }
  })();

  return {
    bus,
    stop() {
      running = false;
      bus.emit({ type: "daemon:shutdown" });
    },
  };
}

// --- Entry point when run as detached daemon process ---

function cleanup(exitCode = 0) {
  try { unlinkSync(getPidPath()); } catch {}
  try { unlinkSync(getSocketPath()); } catch {}
  process.exit(exitCode);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let dataDir: string | undefined;
  let tick = "10s";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--data-dir") dataDir = args[++i];
    else if (args[i] === "--tick") tick = args[++i]!;
  }
  return { dataDir, tick };
}

// Only run main() when executed directly (not imported)
if (import.meta.main) {
  const { dataDir, tick } = parseArgs();
  if (dataDir) setDataDir(dataDir);
  const tickMs = parseInterval(tick);

  ensureDataDir();
  writeFileSync(getPidPath(), String(process.pid));

  const handle = startDaemon(tickMs);

  process.on("SIGTERM", () => { handle.stop(); cleanup(0); });
  process.on("SIGINT", () => { handle.stop(); cleanup(0); });
}
