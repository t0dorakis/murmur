#!/usr/bin/env bun
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import prettyMs from "pretty-ms";
import {
  setDataDir,
  getDataDir,
  ensureDataDir,
  readConfig,
  writeConfig,
  getConfigPath,
  getPidPath,
  getSocketPath,
  parseInterval,
  nextRunAt,
  validateResolvedConfig,
  cleanupRuntimeFiles,
} from "./config.ts";
import { enableDebug, getDebugLogPath } from "./debug.ts";
import { startDaemon, runDaemonMain } from "./daemon.ts";
import { resolveWorkspaceConfig } from "./frontmatter.ts";
import { startSocketServer, type SocketServer } from "./socket.ts";
import { connectToSocket, type SocketConnection } from "./socket-client.ts";
import { createTui } from "./tui.ts";
import { runHeartbeat } from "./heartbeat.ts";
import { appendLog } from "./log.ts";
import { formatToolTarget, formatToolDuration } from "./tool-format.ts";
import type { DaemonEvent } from "./types.ts";
import { listWorkspaces, removeWorkspace, clearWorkspaces } from "./workspaces.ts";

// Injected by `bun build --define` at compile time; falls back to package.json in dev
declare const __VERSION__: string;
const VERSION =
  typeof __VERSION__ !== "undefined"
    ? __VERSION__
    : (() => {
        try {
          return require("../package.json").version;
        } catch {
          return "0.0.0-unknown";
        }
      })();

function readPid(): number | null {
  try {
    const raw = readFileSync(getPidPath(), "utf-8").trim();
    const pid = Number(raw);
    if (Number.isNaN(pid)) {
      console.error(`Corrupt PID file (content: "${raw}"). Ignoring.`);
      return null;
    }
    return pid;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    if (err?.code === "EPERM") return true;
    return false;
  }
}

function cleanStaleSocket() {
  const sockPath = getSocketPath();
  if (existsSync(sockPath)) {
    try {
      unlinkSync(sockPath);
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        console.error(`Warning: could not remove stale socket ${sockPath}: ${err?.message}`);
      }
    }
  }
}

/** Get workspace count and soonest next-heartbeat info from config. */
function getWorkspaceSummary(): { count: number; nextHeartbeat: string | null } {
  try {
    const config = readConfig();
    const count = config.workspaces.length;
    if (count === 0) return { count, nextHeartbeat: null };

    let soonestName: string | null = null;
    let soonestMs = Infinity;

    for (const ws of config.workspaces) {
      try {
        const resolved = resolveWorkspaceConfig(ws);
        if (!resolved.interval && !resolved.cron) continue;
        const nextMs = nextRunAt(resolved) - Date.now();
        if (nextMs < soonestMs) {
          soonestMs = nextMs;
          soonestName = resolved.name ?? basename(ws.path);
        }
      } catch {
        // Skip workspaces with corrupt frontmatter
      }
    }

    if (!soonestName) return { count, nextHeartbeat: null };
    if (soonestMs <= 0) return { count, nextHeartbeat: `${soonestName} (due now)` };
    return {
      count,
      nextHeartbeat: `${soonestName} in ${prettyMs(soonestMs, { secondsDecimalDigits: 0 })}`,
    };
  } catch {
    return { count: 0, nextHeartbeat: null };
  }
}

/** Print daemon status banner with workspace summary and hints. */
function printDaemonBanner(message: string) {
  const { count, nextHeartbeat } = getWorkspaceSummary();
  console.log(`${message} Watching ${count} workspace(s).`);
  if (nextHeartbeat) console.log(`Next heartbeat: ${nextHeartbeat}`);
  console.log(`View status: murmur status`);
  console.log(`Attach to TUI: murmur watch`);
}

function parseGlobalArgs() {
  const raw = process.argv.slice(2);
  let dataDir: string | undefined;
  let tick: string | undefined;
  let interval: string | undefined;
  let cronFlag: string | undefined;
  let timeout: string | undefined;
  let detach = false;
  let daemon = false;
  let debugFlag = false;
  let quiet = false;
  const rest: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "--data-dir") {
      dataDir = raw[++i];
    } else if (raw[i] === "--tick") {
      tick = raw[++i];
    } else if (raw[i] === "--interval") {
      interval = raw[++i];
    } else if (raw[i] === "--cron") {
      cronFlag = raw[++i];
    } else if (raw[i] === "--timeout") {
      timeout = raw[++i];
    } else if (raw[i] === "--detach") {
      detach = true;
    } else if (raw[i] === "--daemon") {
      daemon = true;
    } else if (raw[i] === "--debug") {
      debugFlag = true;
    } else if (raw[i] === "--quiet" || raw[i] === "-q") {
      quiet = true;
    } else {
      rest.push(raw[i]!);
    }
  }
  return {
    dataDir,
    tick,
    interval,
    cron: cronFlag,
    timeout,
    detach,
    daemon,
    debug: debugFlag,
    quiet,
    command: rest[0],
    targetPath: rest[1] ?? ".",
    args: rest,
  };
}

const {
  dataDir,
  tick,
  interval: initInterval,
  cron: initCron,
  timeout: initTimeout,
  detach,
  daemon,
  debug: debugFlag,
  quiet,
  command,
  targetPath,
  args,
} = parseGlobalArgs();
if (dataDir) setDataDir(dataDir);
if (debugFlag) {
  enableDebug();
  console.error(`Debug logging to ${getDebugLogPath()}`);
}

import { createKeyHandler } from "./keys.ts";

// --- Commands ---

async function startForeground() {
  ensureDataDir();
  const pid = readPid();
  if (pid && isProcessAlive(pid)) {
    printDaemonBanner(`Daemon already running (PID ${pid}).`);
    process.exit(0);
  }

  cleanStaleSocket();

  const tickMs = parseInterval(tick ?? "10s");
  const config = readConfig();

  writeFileSync(getPidPath(), String(process.pid));

  console.log(
    `Daemon started (PID ${process.pid}). Watching ${config.workspaces.length} workspace(s). Press Ctrl+C to stop.`,
  );

  const handle = startDaemon(tickMs);

  let socketServer: SocketServer;
  try {
    socketServer = startSocketServer(handle.bus, getSocketPath(), config.workspaces.length);
  } catch (err: any) {
    handle.stop();
    cleanupRuntimeFiles();
    console.error(`Failed to start socket server: ${err?.message}`);
    process.exit(1);
  }

  const tui = createTui(handle.bus);
  tui.start();

  const keys = createKeyHandler();

  async function shutdown() {
    keys.stop();
    tui.stop();
    socketServer.stop();
    await handle.stop();
    cleanupRuntimeFiles();
    process.exit(0);
  }

  function detachToBackground() {
    keys.stop();
    tui.stop();
    console.log("Detached. Reattach with: murmur watch");
    process.stdin.unref();
  }

  keys.start({
    onQuit: shutdown,
    onDetach: detachToBackground,
  });

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function startDetached() {
  ensureDataDir();
  const pid = readPid();
  if (pid && isProcessAlive(pid)) {
    printDaemonBanner(`Daemon already running (PID ${pid}).`);
    process.exit(0);
  }

  const isCompiled = process.execPath === process.argv[0];
  const daemonArgs = isCompiled
    ? [process.execPath, "--daemon"]
    : [process.execPath, import.meta.filename, "--daemon"];
  if (dataDir) daemonArgs.push("--data-dir", dataDir);
  if (tick) daemonArgs.push("--tick", tick);
  if (debugFlag) daemonArgs.push("--debug");

  const stderrLog = join(getDataDir(), "daemon-stderr.log");
  const proc = Bun.spawn(daemonArgs, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: Bun.file(stderrLog),
  });
  proc.unref();

  await Bun.sleep(500);
  const newPid = readPid();
  if (newPid && isProcessAlive(newPid)) {
    printDaemonBanner(`Daemon started (PID ${newPid}).`);
  } else {
    const stderr = existsSync(stderrLog) ? readFileSync(stderrLog, "utf-8").trim() : "";
    console.error(`Daemon failed to start.${stderr ? `\n${stderr}` : ""}`);
    process.exit(1);
  }
}

function stop() {
  const pid = readPid();
  if (!pid || !isProcessAlive(pid)) {
    console.log("Not running.");
    return;
  }
  process.kill(pid, "SIGTERM");
  const { count } = getWorkspaceSummary();
  console.log(`Daemon stopped (PID ${pid}). ${count} workspace(s) released.`);
  console.log(`Restart: murmur start --detach`);
}

function status() {
  const pid = readPid();
  const alive = pid ? isProcessAlive(pid) : false;

  if (alive) {
    console.log(`Daemon: running (PID ${pid})`);
  } else {
    console.log("Daemon: stopped");
  }

  const config = readConfig();
  if (config.workspaces.length === 0) {
    console.log(`No workspaces configured. Edit ${getConfigPath()} to add workspaces.`);
    return;
  }

  console.log(`\nWorkspaces (${config.workspaces.length}):`);
  const rows = config.workspaces.map((ws) => {
    const resolved = resolveWorkspaceConfig(ws);
    const name = resolved.name ?? basename(ws.path);
    const schedule = resolved.interval
      ? `every ${resolved.interval}`
      : resolved.cron
        ? `cron ${resolved.cron}`
        : "(none)";
    let lastRun = "never";
    if (ws.lastRun) {
      const t = new Date(ws.lastRun).getTime();
      if (Number.isNaN(t)) {
        lastRun = "invalid";
      } else {
        const diff = Date.now() - t;
        lastRun = diff > 0 ? `${prettyMs(diff, { compact: true })} ago` : "just now";
      }
    }
    return { name, schedule, lastRun, path: ws.path };
  });

  const nameW = Math.max(...rows.map((r) => r.name.length));
  const schedW = Math.max(...rows.map((r) => r.schedule.length));
  const lastW = Math.max(...rows.map((r) => r.lastRun.length));

  for (const r of rows) {
    const nameCol = r.name.padEnd(nameW);
    const schedCol = r.schedule.padEnd(schedW);
    const lastCol = r.lastRun.padEnd(lastW);
    console.log(`  ${nameCol}  ${schedCol}  last: ${lastCol}  ${r.path}`);
  }
}

async function watch() {
  const sockPath = getSocketPath();
  if (!existsSync(sockPath)) {
    console.error("Daemon is not running. Start it first with: murmur start --detach");
    process.exit(1);
  }

  let conn: SocketConnection;
  try {
    conn = await connectToSocket(sockPath);
  } catch (err: any) {
    console.error(`Cannot connect to daemon: ${err.message}`);
    process.exit(1);
  }

  const tui = createTui(conn);
  tui.start();

  const keys = createKeyHandler();

  function disconnect() {
    keys.stop();
    tui.stop();
    conn.close();
    process.exit(0);
  }

  keys.start({
    onQuit: disconnect,
    onDetach: disconnect,
  });

  conn.subscribe((event) => {
    if (event.type === "daemon:shutdown") {
      keys.stop();
      tui.stop();
      console.log("Daemon stopped.");
      process.exit(0);
    }
  });
}

async function beat(path: string, quietMode: boolean) {
  const resolved = resolve(path);
  const heartbeatFile = join(resolved, "HEARTBEAT.md");
  if (!existsSync(heartbeatFile)) {
    console.error(`No HEARTBEAT.md found in ${resolved}. Run "murmur init ${path}" first.`);
    process.exit(1);
  }

  console.log(`Running heartbeat for ${resolved}...`);
  if (!quietMode) {
    console.log(`(showing tool calls and reasoning)\n`);
  }

  const ws = resolveWorkspaceConfig({ path: resolved, lastRun: null });
  const entry = await runHeartbeat(ws, quietMode ? undefined : cliEmitter, {
    quiet: quietMode,
  });
  appendLog(entry);

  if (!quietMode && entry.turns && entry.turns.length > 0) {
    console.log("\n--- Conversation Summary ---\n");
    for (const turn of entry.turns) {
      if (turn.role === "result") {
        if (turn.costUsd != null) {
          console.log(`  Cost: $${turn.costUsd.toFixed(6)}`);
        }
        if (turn.numTurns != null) {
          console.log(`  Agent turns: ${turn.numTurns}`);
        }
      }
    }
    console.log("");
  }

  if (entry.outcome === "ok") {
    console.log("OK — nothing to report.");
  } else if (entry.outcome === "attention") {
    console.log(`ATTENTION: ${entry.summary}`);
  } else {
    console.error(`ERROR: ${entry.error}`);
  }
  console.log(`(${prettyMs(entry.durationMs)})`);
}

function cliEmitter(event: DaemonEvent) {
  switch (event.type) {
    case "heartbeat:tool-call": {
      const target = formatToolTarget(event.toolCall.input);
      const duration = formatToolDuration(event.toolCall.durationMs);
      console.log(`◆ ${event.toolCall.name} ${target}${duration ? ` ${duration}` : ""}`);
      break;
    }
    case "heartbeat:stdout":
      // Stream assistant text as it arrives
      process.stdout.write(event.chunk);
      break;
  }
}

const HEARTBEAT_TEMPLATE = (interval: string, timeout?: string, cron?: string) => {
  const lines = ["---"];
  if (cron) {
    lines.push(`cron: ${cron}`);
  } else {
    lines.push(`interval: ${interval}`);
  }
  if (timeout) lines.push(`timeout: ${timeout}`);
  lines.push(
    "# name: My Heartbeat",
    "# description: What this heartbeat does",
    "# agent: claude-code",
    "# model: opus",
    "# maxTurns: 50",
    "---",
    "",
    "Write anything you would like to automate.",
    "",
  );
  return lines.join("\n");
};

async function init(path: string, opts?: { interval?: string; cron?: string; timeout?: string }) {
  if (opts?.interval) {
    try {
      parseInterval(opts.interval);
    } catch {
      console.error(`Invalid interval: "${opts.interval}". Use e.g. "30m", "1h", "15m".`);
      process.exit(1);
    }
  }
  if (opts?.timeout) {
    try {
      parseInterval(opts.timeout);
    } catch {
      console.error(`Invalid timeout: "${opts.timeout}". Use e.g. "15m", "1h".`);
      process.exit(1);
    }
  }
  if (opts?.cron) {
    // Validate by constructing a minimal workspace config
    const cronErr = validateResolvedConfig({
      path: ".",
      cron: opts.cron,
      lastRun: null,
    });
    if (cronErr) {
      console.error(`Invalid cron: "${opts.cron}".`);
      process.exit(1);
    }
  }

  const resolved = resolve(path);
  const heartbeatFile = join(resolved, "HEARTBEAT.md");
  if (!existsSync(heartbeatFile)) {
    const tpl = HEARTBEAT_TEMPLATE(opts?.interval ?? "1h", opts?.timeout, opts?.cron);
    await Bun.write(heartbeatFile, tpl);
    console.log(`Created ${heartbeatFile}`);
  } else {
    console.log(`HEARTBEAT.md already exists in ${resolved}.`);
  }

  ensureDataDir();
  const config = readConfig();
  const alreadyRegistered = config.workspaces.some((ws) => ws.path === resolved);
  if (!alreadyRegistered) {
    config.workspaces.push({ path: resolved, lastRun: null });
    await writeConfig(config);
    console.log(`Added workspace to config.`);
  }
}

function printHelp() {
  console.log(`Usage: murmur [options] <command> [args]

Commands:
  start [--tick <interval>]    Start daemon with TUI (foreground)
  start --detach               Start daemon in background
  watch                        Attach TUI to running daemon
  stop                         Stop the daemon
  status                       Show daemon and workspace status
  beat [path]                  Run one heartbeat immediately
  init [path]                  Create HEARTBEAT.md template
  workspaces list              List all configured workspaces
  workspaces remove <path>     Remove a workspace from config
  workspaces clear             Remove all workspaces from config

Options:
  --data-dir <path>            Override data directory (default: ~/.murmur)
  --interval <interval>        Set interval in HEARTBEAT.md (init only, e.g. 30m)
  --cron <expr>                Set cron in HEARTBEAT.md (init only, e.g. "0 9 * * *")
  --timeout <interval>         Set timeout in HEARTBEAT.md (init only, e.g. 15m)
  --debug                      Enable debug logging to <data-dir>/debug.log
  --quiet, -q                  Hide tool calls during beat (show summary only)
  --help, -h                   Show this help message
  --version, -v                Show version`);
}

if (command === "--version" || command === "-v") {
  console.log(VERSION);
  process.exit(0);
}

if (command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (daemon) {
  runDaemonMain({ dataDir, tick, debug: debugFlag });
  // runDaemonMain installs signal handlers and keeps the process alive
} else
  switch (command) {
    case "start":
      if (detach) {
        await startDetached();
      } else {
        await startForeground();
      }
      break;
    case "stop":
      stop();
      break;
    case "status":
      status();
      break;
    case "watch":
      await watch();
      break;
    case "beat":
      await beat(targetPath, quiet);
      break;
    case "init":
      await init(targetPath, {
        interval: initInterval,
        cron: initCron,
        timeout: initTimeout,
      });
      break;
    case "workspaces": {
      const subcommand = args[1];
      const wsPath = args[2];

      switch (subcommand) {
        case "list":
          listWorkspaces();
          break;
        case "remove":
          if (!wsPath) {
            console.error("Usage: murmur workspaces remove <path>");
            process.exit(1);
          }
          const removed = await removeWorkspace(wsPath);
          process.exit(removed ? 0 : 1);
          break;
        case "clear": {
          const cleared = await clearWorkspaces();
          process.exit(cleared ? 0 : 1);
          break;
        }
        default:
          console.error(subcommand ? `Unknown subcommand: ${subcommand}` : "Missing subcommand");
          console.error("Usage: murmur workspaces <list|remove|clear>");
          process.exit(1);
      }
      break;
    }
    default:
      printHelp();
      process.exit(1);
  }
