import { resolve } from "node:path";
import { readConfig, writeConfig } from "./config.ts";

export function listWorkspaces(): void {
  const config = readConfig();

  if (config.workspaces.length === 0) {
    console.log("No workspaces configured.");
    console.log("Add one with: murmur init <path>");
    return;
  }

  console.log(`Workspaces (${config.workspaces.length}):\n`);
  for (const ws of config.workspaces) {
    console.log(`  ${ws.path}`);
    const schedule = ws.cron
      ? `cron ${ws.cron}${ws.tz ? ` (${ws.tz})` : ""}`
      : `every ${ws.interval}`;
    console.log(`    Schedule: ${schedule}`);
    console.log(`    Last run: ${ws.lastRun ?? "never"}`);
    if (ws.maxTurns) console.log(`    Max turns: ${ws.maxTurns}`);
    console.log("");
  }
}

export async function removeWorkspace(targetPath: string): Promise<boolean> {
  const resolved = resolve(targetPath);
  const config = readConfig();

  const index = config.workspaces.findIndex((ws) => ws.path === resolved);
  if (index === -1) {
    console.error(`Workspace not found: ${resolved}`);
    return false;
  }

  config.workspaces.splice(index, 1);
  try {
    await writeConfig(config);
  } catch (err) {
    console.error(`Failed to write config: ${err instanceof Error ? err.message : err}`);
    return false;
  }
  console.log(`Removed workspace: ${resolved}`);
  return true;
}

export async function clearWorkspaces(): Promise<boolean> {
  const config = readConfig();
  const count = config.workspaces.length;

  config.workspaces = [];
  try {
    await writeConfig(config);
  } catch (err) {
    console.error(`Failed to write config: ${err instanceof Error ? err.message : err}`);
    return false;
  }
  console.log(`Cleared ${count} workspace(s).`);
  return true;
}
