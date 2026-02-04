import { writeFileSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setDataDir, ensureDataDir, isDue, parseInterval, readConfig, updateLastRun, getPidPath, getSocketPath, cleanupRuntimeFiles } from "./config.ts";
import { createEventBus, type EventBus } from "./events.ts";
import { runHeartbeat } from "./heartbeat.ts";
import { appendLog } from "./log.ts";
import { startSocketServer } from "./socket.ts";
import type { WorkspaceConfig, WorkspaceStatus } from "./types.ts";

function workspaceName(ws: WorkspaceConfig): string {
  try {
    const text = readFileSync(join(ws.path, "HEARTBEAT.md"), "utf-8");
    const match = /^#\s+(.+)/m.exec(text);
    if (match) return match[1]!.trim();
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.error(`Warning: could not read HEARTBEAT.md in ${ws.path}: ${err?.message}`);
    }
  }
  return basename(ws.path);
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
  stop(): Promise<void>;
};

export function startDaemon(tickMs: number): DaemonHandle {
  const bus = createEventBus();
  let running = true;

  const initialConfig = readConfig();

  const loopDone = (async () => {
    await Promise.resolve(); // yield so callers can subscribe before first events
    bus.emit({ type: "daemon:ready", pid: process.pid, workspaceCount: initialConfig.workspaces.length });

    while (running) {
      try {
        const config = readConfig();
        bus.emit({ type: "tick", workspaces: buildWorkspaceStatuses(config.workspaces) });

        for (const ws of config.workspaces) {
          if (!running) break;
          if (!isDue(ws)) continue;

          const entry = await runHeartbeat(ws, bus.emit.bind(bus));
          appendLog(entry);

          await updateLastRun(ws.path, entry.ts);
        }
      } catch (err) {
        console.error("Daemon loop error:", err);
      }

      if (running) await Bun.sleep(tickMs);
    }
  })();

  return {
    bus,
    async stop() {
      running = false;
      bus.emit({ type: "daemon:shutdown" });
      await loopDone;
    },
  };
}

// --- Entry point when run as detached daemon process ---

function cleanup(exitCode = 0) {
  cleanupRuntimeFiles();
  process.exit(exitCode);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let dataDir: string | undefined;
  let tick = "10s";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--data-dir") dataDir = args[++i];
    else if (args[i] === "--tick") tick = args[++i] ?? tick;
  }
  return { dataDir, tick };
}

if (import.meta.main) {
  const { dataDir, tick } = parseArgs();
  if (dataDir) setDataDir(dataDir);
  const tickMs = parseInterval(tick);

  ensureDataDir();
  writeFileSync(getPidPath(), String(process.pid));

  const initialConfig = readConfig();
  const handle = startDaemon(tickMs);
  const socketServer = startSocketServer(handle.bus, getSocketPath(), initialConfig.workspaces.length);

  function shutdown() {
    handle.stop();
    socketServer.stop();
    cleanup(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
