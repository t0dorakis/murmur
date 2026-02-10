import { writeFileSync } from "node:fs";
import {
  setDataDir,
  ensureDataDir,
  isDue,
  nextRunAt,
  parseInterval,
  parseLastRun,
  readConfig,
  updateLastRun,
  validateResolvedConfig,
  getPidPath,
  getSocketPath,
  cleanupRuntimeFiles,
} from "./config.ts";
import { debug, enableDebug } from "./debug.ts";
import { heartbeatId, heartbeatDisplayName, expandWorkspace } from "./discovery.ts";
import { createEventBus, type EventBus } from "./events.ts";
import { resolveWorkspaceConfig } from "./frontmatter.ts";
import { runHeartbeat } from "./heartbeat.ts";
import { appendLog } from "./log.ts";
import { startSocketServer } from "./socket.ts";
import { readActiveBeats, clearActiveBeats } from "./active-beats.ts";
import { isProcessAlive, killProcess } from "./process-utils.ts";
import type { WorkspaceConfig, WorkspaceStatus, LogEntry } from "./types.ts";

export function buildWorkspaceStatuses(resolved: WorkspaceConfig[]): WorkspaceStatus[] {
  return resolved.map((ws) => ({
    id: heartbeatId(ws),
    path: ws.path,
    name: ws.name ?? heartbeatDisplayName(ws),
    description: ws.description,
    schedule: ws.interval ?? ws.cron ?? "(none)",
    scheduleType: ws.cron ? ("cron" as const) : ("interval" as const),
    nextRunAt: nextRunAt(ws),
    lastOutcome: null,
    lastRunAt: parseLastRun(ws),
  }));
}

export type DaemonHandle = {
  bus: EventBus;
  stop(): Promise<void>;
};

/**
 * Recover from previous daemon crash by detecting and handling orphaned agent processes.
 * Called once at daemon startup before entering the scheduling loop.
 */
async function recoverOrphanedProcesses(): Promise<void> {
  const activeBeats = readActiveBeats();
  const entries = Object.entries(activeBeats);

  if (entries.length === 0) {
    debug("[recovery] No active beats to recover");
    return;
  }

  debug(`[recovery] Found ${entries.length} active beat(s) from previous session`);

  for (const [id, beat] of entries) {
    const alive = isProcessAlive(beat.pid);

    if (alive) {
      debug(`[recovery] Orphaned process found: ${id} (PID ${beat.pid}) — killing`);
      const killed = killProcess(beat.pid);
      if (killed) {
        debug(`[recovery] Sent SIGTERM to PID ${beat.pid}`);
      } else {
        debug(`[recovery] Failed to kill PID ${beat.pid}`);
      }

      const ts = new Date().toISOString();
      const entry: LogEntry = {
        ts,
        workspace: id,
        outcome: "recovered",
        durationMs: 0,
        summary: killed
          ? `Killed orphaned process (PID ${beat.pid}) from previous daemon session`
          : `Found orphaned process (PID ${beat.pid}) but failed to kill it`,
      };
      appendLog(entry);

      if (!killed) {
        console.error(
          `Warning: could not kill orphaned process ${beat.pid} for ${id}. It may still be running.`,
        );
      }
    } else {
      debug(`[recovery] Process already dead: ${id} (PID ${beat.pid})`);

      const ts = new Date().toISOString();
      const entry: LogEntry = {
        ts,
        workspace: id,
        outcome: "lost",
        durationMs: 0,
        summary: `Process (PID ${beat.pid}) from previous daemon session crashed or was killed`,
      };
      appendLog(entry);
    }
  }

  // Clear the active-beats file after recovery
  await clearActiveBeats();
  debug("[recovery] Recovery complete");
}

export function startDaemon(tickMs: number): DaemonHandle {
  const bus = createEventBus();
  let running = true;

  const initialConfig = readConfig();

  const loopDone = (async () => {
    await Promise.resolve(); // yield so callers can subscribe before first events

    // Recover orphaned processes from previous daemon session
    try {
      await recoverOrphanedProcesses();
    } catch (err) {
      console.error("Recovery error:", err);
      debug(`Recovery error: ${err}`);
    }

    debug(
      `Daemon ready (PID ${process.pid}, ${initialConfig.workspaces.length} workspace(s), tick=${tickMs}ms)`,
    );
    bus.emit({
      type: "daemon:ready",
      pid: process.pid,
      workspaceCount: initialConfig.workspaces.length,
    });

    while (running) {
      try {
        const config = readConfig();
        debug(`Tick: checking ${config.workspaces.length} workspace(s)`);

        // Expand multi-heartbeat workspaces, then resolve frontmatter
        const resolved: WorkspaceConfig[] = [];
        for (const ws of config.workspaces) {
          const expanded = expandWorkspace(ws);
          for (const ews of expanded) {
            const r = resolveWorkspaceConfig(ews);
            const error = validateResolvedConfig(r);
            if (error) {
              debug(`  ${heartbeatId(ews)}: skipping — ${error}`);
              continue;
            }
            resolved.push(r);
          }
        }

        bus.emit({
          type: "tick",
          workspaces: buildWorkspaceStatuses(resolved),
        });

        for (const ws of resolved) {
          if (!running) break;
          const due = isDue(ws);
          const id = heartbeatId(ws);
          debug(`  ${id}: isDue=${due}`);
          if (!due) continue;

          const entry = await runHeartbeat(ws, bus.emit.bind(bus));
          appendLog(entry);

          await updateLastRun(ws.path, entry.ts, ws.heartbeatFile);
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

  let socketServer: ReturnType<typeof startSocketServer>;
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
