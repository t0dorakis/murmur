import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, ensureDataDir, isDue, readConfig, writeConfig } from "./config.ts";
import { runHeartbeat } from "./heartbeat.ts";
import { appendLog } from "./log.ts";

const PID_PATH = join(DATA_DIR, "orchester.pid");
let running = true;

function cleanup() {
  try {
    unlinkSync(PID_PATH);
  } catch {}
  process.exit(0);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

async function main() {
  ensureDataDir();
  writeFileSync(PID_PATH, String(process.pid));

  while (running) {
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

    await Bun.sleep(10_000);
  }
}

main().catch((err) => {
  console.error("Daemon crashed:", err);
  cleanup();
});
