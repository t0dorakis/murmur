import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setDataDir, ensureDataDir, isDue, parseInterval, readConfig, writeConfig, getPidPath, getSocketPath } from "./config.ts";
import { createEventBus, type EventBus } from "./events.ts";
import { runHeartbeat } from "./heartbeat.ts";
import { appendLog } from "./log.ts";
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
  stop(): void;
};

export function startDaemon(tickMs: number): DaemonHandle {
  const bus = createEventBus();
  let running = true;

  const config = readConfig();
  bus.emit({ type: "daemon:ready", pid: process.pid, workspaceCount: config.workspaces.length });

  (async () => {
    while (running) {
      try {
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
      } catch (err) {
        console.error("Daemon loop error:", err);
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
