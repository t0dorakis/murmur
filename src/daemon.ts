import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getDataDir, setDataDir, ensureDataDir, isDue, parseInterval, readConfig, writeConfig } from "./config.ts";
import { runHeartbeat } from "./heartbeat.ts";
import { appendLog } from "./log.ts";

function getPidPath() {
  return join(getDataDir(), "orchester.pid");
}

function cleanup() {
  try {
    unlinkSync(getPidPath());
  } catch {}
  process.exit(0);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

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

async function main() {
  const { dataDir, tick } = parseArgs();
  if (dataDir) setDataDir(dataDir);
  const tickMs = parseInterval(tick);

  ensureDataDir();
  writeFileSync(getPidPath(), String(process.pid));

  while (true) {
    const config = readConfig();

    for (const ws of config.workspaces) {
      if (!isDue(ws)) continue;

      const entry = await runHeartbeat(ws);
      appendLog(entry);

      if (entry.outcome === "attention") {
        console.log(`[${entry.ts}] ${ws.path}: ${entry.summary}`);
      } else if (entry.outcome === "error") {
        console.error(`[${entry.ts}] ${ws.path}: ERROR — ${entry.error}`);
      }

      ws.lastRun = entry.ts;
      await writeConfig(config);
    }

    await Bun.sleep(tickMs);
  }
}

main().catch((err) => {
  console.error("Daemon crashed:", err);
  cleanup();
});
