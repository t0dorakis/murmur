#!/usr/bin/env bun
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { getDataDir, setDataDir, ensureDataDir, readConfig, getConfigPath, getPidPath, parseInterval } from "./config.ts";
import { startDaemon, getSocketPath } from "./daemon.ts";
import { startSocketServer } from "./socket.ts";
import { connectToSocket } from "./socket-client.ts";
import { createTui } from "./tui.ts";
import { runHeartbeat } from "./heartbeat.ts";
import { appendLog } from "./log.ts";

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
    try { unlinkSync(sockPath); } catch {}
  }
}

function parseGlobalArgs() {
  const raw = process.argv.slice(2);
  let dataDir: string | undefined;
  let tick: string | undefined;
  let detach = false;
  const rest: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "--data-dir") {
      dataDir = raw[++i];
    } else if (raw[i] === "--tick") {
      tick = raw[++i];
    } else if (raw[i] === "--detach") {
      detach = true;
    } else {
      rest.push(raw[i]!);
    }
  }
  return { dataDir, tick, detach, command: rest[0], arg: rest[1] ?? "." };
}

const { dataDir, tick, detach, command, arg } = parseGlobalArgs();
if (dataDir) setDataDir(dataDir);

// --- Keyboard input handling ---

type KeyHandler = {
  start(callbacks: { onQuit(): void; onDetach(): void }): void;
  stop(): void;
};

function createKeyHandler(): KeyHandler {
  let active = false;
  let callbacks: { onQuit(): void; onDetach(): void } | null = null;

  function onData(data: Buffer) {
    if (!callbacks) return;
    const key = data.toString();
    if (key === "q" || key === "\x03") {
      // q or Ctrl+C
      callbacks.onQuit();
    } else if (key === "\x04") {
      // Ctrl+D
      callbacks.onDetach();
    }
  }

  return {
    start(cbs) {
      callbacks = cbs;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("data", onData);
        active = true;
      }
    },
    stop() {
      if (active) {
        process.stdin.removeListener("data", onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        active = false;
      }
      callbacks = null;
    },
  };
}

// --- Commands ---

async function startForeground() {
  ensureDataDir();
  const pid = readPid();
  if (pid && isProcessAlive(pid)) {
    console.log(`Already running (PID ${pid}). Use "murmur watch" to attach.`);
    process.exit(1);
  }

  cleanStaleSocket();

  const tickMs = parseInterval(tick ?? "10s");

  // Write our own PID
  writeFileSync(getPidPath(), String(process.pid));

  // Start daemon loop
  const handle = startDaemon(tickMs);

  // Start socket server for watch clients
  const socketServer = startSocketServer(handle.bus, getSocketPath());

  // Start TUI
  const tui = createTui(handle.bus);
  tui.start();

  // Keyboard handling
  const keys = createKeyHandler();

  function shutdown() {
    keys.stop();
    tui.stop();
    socketServer.stop();
    handle.stop();
    try { unlinkSync(getPidPath()); } catch {}
    try { unlinkSync(getSocketPath()); } catch {}
    process.exit(0);
  }

  function detachToBackground() {
    keys.stop();
    tui.stop();
    // Daemon loop + socket server keep running in this process
    // The user can reattach with murmur watch
    console.log("Detached. Reattach with: murmur watch");
    // Redirect stdio so the process can survive terminal close
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
    console.log(`Already running (PID ${pid}).`);
    process.exit(1);
  }

  const daemonPath = join(import.meta.dir, "daemon.ts");
  const daemonArgs = ["bun", daemonPath];
  if (dataDir) daemonArgs.push("--data-dir", dataDir);
  if (tick) daemonArgs.push("--tick", tick);

  const proc = Bun.spawn(daemonArgs, {
    stdio: ["ignore", "ignore", "ignore"],
  });
  proc.unref();

  await Bun.sleep(500);
  const newPid = readPid();
  if (newPid && isProcessAlive(newPid)) {
    console.log(`Started (PID ${newPid}).`);
  } else {
    console.error("Daemon failed to start.");
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
  console.log(`Stopped (PID ${pid}).`);
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
  for (const ws of config.workspaces) {
    const lastRun = ws.lastRun ?? "never";
    console.log(`  ${ws.path}  every ${ws.interval}  last: ${lastRun}`);
  }
}

async function watch() {
  const sockPath = getSocketPath();
  if (!existsSync(sockPath)) {
    console.error("Daemon is not running. Start it first with: murmur start --detach");
    process.exit(1);
  }

  let conn: Awaited<ReturnType<typeof connectToSocket>>;
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

  // Watch mode: q/Ctrl+C disconnects. Ctrl+D also disconnects (no daemon to detach from).
  keys.start({
    onQuit: disconnect,
    onDetach: disconnect,
  });

  // Handle daemon going away
  conn.subscribe((event) => {
    if (event.type === "daemon:shutdown") {
      keys.stop();
      tui.stop();
      console.log("Daemon stopped.");
      process.exit(0);
    }
  });
}

async function beat(path: string) {
  const resolved = resolve(path);
  const heartbeatFile = join(resolved, "HEARTBEAT.md");
  if (!existsSync(heartbeatFile)) {
    console.error(`No HEARTBEAT.md found in ${resolved}. Run "murmur init ${path}" first.`);
    process.exit(1);
  }

  console.log(`Running heartbeat for ${resolved}...`);
  const entry = await runHeartbeat({ path: resolved, interval: "1h", lastRun: null });
  appendLog(entry);

  if (entry.outcome === "ok") {
    console.log("OK — nothing to report.");
  } else if (entry.outcome === "attention") {
    console.log(`ATTENTION: ${entry.summary}`);
  } else {
    console.error(`ERROR: ${entry.error}`);
  }
  console.log(`(${entry.durationMs}ms)`);
}

const HEARTBEAT_TEMPLATE = `# Heartbeat

What to do on each heartbeat. If nothing needs attention, respond with
exactly \`HEARTBEAT_OK\`. Otherwise, start with \`ATTENTION:\` and a brief summary.

## Do this

- Check for new GitHub issues on my-org/my-repo using \`gh\`
- For any untagged issues, add a triage label based on the content
- If there are urgent issues (security, data loss, outage), tell me
`;

async function init(path: string) {
  const resolved = resolve(path);
  const heartbeatFile = join(resolved, "HEARTBEAT.md");
  if (existsSync(heartbeatFile)) {
    console.log(`HEARTBEAT.md already exists in ${resolved}.`);
    return;
  }
  await Bun.write(heartbeatFile, HEARTBEAT_TEMPLATE);
  console.log(`Created ${heartbeatFile}`);
}

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
    await beat(arg);
    break;
  case "init":
    await init(arg);
    break;
  default:
    console.log(`Usage: murmur [--data-dir <path>] <command> [options]

Commands:
  start [--tick <interval>]    Start daemon with TUI (foreground)
  start --detach               Start daemon in background
  watch                        Attach TUI to running daemon
  stop                         Stop the daemon
  status                       Show daemon and workspace status
  beat [path]                  Run one heartbeat immediately
  init [path]                  Create HEARTBEAT.md template`);
    process.exit(command ? 1 : 0);
}
