import { writeFileSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setDataDir, ensureDataDir, isDue, nextRunAt, parseInterval, readConfig, updateLastRun, getPidPath, getSocketPath, cleanupRuntimeFiles } from "./config.ts";
import { debug, enableDebug } from "./debug.ts";
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
  return workspaces.map((ws) => ({
    path: ws.path,
    name: workspaceName(ws),
    schedule: ws.interval ?? ws.cron ?? "(none)",
    scheduleType: ws.cron ? "cron" as const : "interval" as const,
    nextRunAt: nextRunAt(ws),
    lastOutcome: null,
    lastRunAt: ws.lastRun ? new Date(ws.lastRun).getTime() : null,
  }));
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
    debug(`Daemon ready (PID ${process.pid}, ${initialConfig.workspaces.length} workspace(s), tick=${tickMs}ms)`);
    bus.emit({ type: "daemon:ready", pid: process.pid, workspaceCount: initialConfig.workspaces.length });

    while (running) {
      try {
        const config = readConfig();
        debug(`Tick: checking ${config.workspaces.length} workspace(s)`);
        bus.emit({ type: "tick", workspaces: buildWorkspaceStatuses(config.workspaces) });

        for (const ws of config.workspaces) {
          if (!running) break;
          const due = isDue(ws);
          debug(`  ${ws.path}: isDue=${due}`);
          if (!due) continue;

          const entry = await runHeartbeat(ws, bus.emit.bind(bus));
          appendLog(entry);

          await updateLastRun(ws.path, entry.ts);
        }
      } catch (err) {
        console.error("Daemon loop error:", err);
        debug(`Daemon loop error: ${err}`);
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

export function runDaemonMain(opts: { dataDir?: string; tick?: string; debug?: boolean }) {
  if (opts.dataDir) setDataDir(opts.dataDir);
  if (opts.debug) enableDebug();
  const tickMs = parseInterval(opts.tick ?? "10s");

  ensureDataDir();
  writeFileSync(getPidPath(), String(process.pid));

  const initialConfig = readConfig();
  const handle = startDaemon(tickMs);

  let socketServer;
  try {
    socketServer = startSocketServer(handle.bus, getSocketPath(), initialConfig.workspaces.length);
  } catch (err: any) {
    handle.stop();
    cleanupRuntimeFiles();
    console.error(`Failed to start socket server: ${err?.message}`);
    process.exit(1);
  }

  function shutdown() {
    handle.stop();
    socketServer.stop();
    cleanup(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let dataDir: string | undefined;
  let tick = "10s";
  let debugFlag = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--data-dir") dataDir = args[++i];
    else if (args[i] === "--tick") tick = args[++i] ?? tick;
    else if (args[i] === "--debug") debugFlag = true;
  }
  return { dataDir, tick, debug: debugFlag };
}

if (import.meta.main) {
  const { dataDir, tick, debug: debugFlag } = parseArgs();
  runDaemonMain({ dataDir, tick, debug: debugFlag });
}
