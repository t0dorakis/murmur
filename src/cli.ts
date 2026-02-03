#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { getDataDir, setDataDir, ensureDataDir, readConfig } from "./config.ts";
import { runHeartbeat } from "./heartbeat.ts";
import { appendLog } from "./log.ts";

function getPidPath() {
  return join(getDataDir(), "murmur.pid");
}

function readPid(): number | null {
  try {
    return Number(readFileSync(getPidPath(), "utf-8").trim());
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseGlobalArgs() {
  const raw = process.argv.slice(2);
  let dataDir: string | undefined;
  let tick: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "--data-dir") {
      dataDir = raw[++i];
    } else if (raw[i] === "--tick") {
      tick = raw[++i];
    } else {
      rest.push(raw[i]!);
    }
  }
  return { dataDir, tick, command: rest[0], arg: rest[1] ?? "." };
}

const { dataDir, tick, command, arg } = parseGlobalArgs();
if (dataDir) setDataDir(dataDir);

async function start() {
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

  // Give daemon a moment to write PID
  await Bun.sleep(500);
  const newPid = readPid();
  console.log(`Started (PID ${newPid ?? proc.pid}).`);
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
    console.log("No workspaces configured. Edit ~/.murmur/config.json to add workspaces.");
    return;
  }

  console.log(`\nWorkspaces (${config.workspaces.length}):`);
  for (const ws of config.workspaces) {
    const lastRun = ws.lastRun ?? "never";
    console.log(`  ${ws.path}  every ${ws.interval}  last: ${lastRun}`);
  }
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
    await start();
    break;
  case "stop":
    stop();
    break;
  case "status":
    status();
    break;
  case "beat":
    await beat(arg);
    break;
  case "init":
    await init(arg);
    break;
  default:
    console.log(`Usage: murmur [--data-dir <path>] <start [--tick <interval>]|stop|status|beat|init> [path]`);
    process.exit(command ? 1 : 0);
}
