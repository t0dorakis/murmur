import { resolve } from "node:path";
import { readConfig, writeConfig } from "./config.ts";
import { expandWorkspace, heartbeatId } from "./discovery.ts";
import { resolveWorkspaceConfig } from "./frontmatter.ts";

export function listWorkspaces(): void {
  const config = readConfig();

  if (config.workspaces.length === 0) {
    console.log("No workspaces configured.");
    console.log("Add one with: murmur init <path>");
    return;
  }

  // Expand multi-heartbeat workspaces
  const expanded = config.workspaces.flatMap(expandWorkspace);

  console.log(`Heartbeats (${expanded.length}):\n`);
  for (const ws of expanded) {
    const resolved = resolveWorkspaceConfig(ws);
    const id = heartbeatId(ws);
    console.log(`  ${id}`);
    if (resolved.name) console.log(`    Name: ${resolved.name}`);
    if (resolved.description) console.log(`    Description: ${resolved.description}`);
    const schedule = resolved.cron
      ? `cron ${resolved.cron}${resolved.tz ? ` (${resolved.tz})` : ""}`
      : resolved.interval
        ? `every ${resolved.interval}`
        : "(none)";
    console.log(`    Schedule: ${schedule}`);
    if (resolved.timeout) console.log(`    Timeout: ${resolved.timeout}`);
    console.log(`    Last run: ${ws.lastRun ?? "never"}`);
    if (resolved.agent) console.log(`    Agent: ${resolved.agent}`);
    if (resolved.model) console.log(`    Model: ${resolved.model}`);
    if (resolved.maxTurns) console.log(`    Max turns: ${resolved.maxTurns}`);
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
