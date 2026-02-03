import { join } from "node:path";
import type { LogEntry, Outcome, WorkspaceConfig } from "./types.ts";

export async function buildPrompt(ws: WorkspaceConfig): Promise<string> {
  const heartbeatPath = join(ws.path, "HEARTBEAT.md");
  const file = Bun.file(heartbeatPath);
  if (!(await file.exists())) {
    throw new Error(`HEARTBEAT.md not found in ${ws.path}`);
  }
  const contents = await file.text();
  return `You are a heartbeat agent. Follow the instructions below.

WORKSPACE: ${ws.path}
TIME: ${new Date().toISOString()}

---
${contents}
---

Rules:
- Do what the instructions above ask.
- If there is nothing to report: respond with exactly HEARTBEAT_OK (nothing else).
- If something needs human attention: respond with ATTENTION: followed by a concise summary.
- Be brief.`;
}

export function classify(stdout: string, exitCode: number): Outcome {
  if (exitCode !== 0) return "error";
  if (stdout.includes("HEARTBEAT_OK")) return "ok";
  return "attention";
}

export async function runHeartbeat(ws: WorkspaceConfig): Promise<LogEntry> {
  const ts = new Date().toISOString();
  const start = Date.now();

  let prompt: string;
  try {
    prompt = await buildPrompt(ws);
  } catch (err) {
    return {
      ts,
      workspace: ws.path,
      outcome: "error",
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const proc = Bun.spawn(
    ["claude", "--print", "--dangerously-skip-permissions", "--max-turns", String(ws.maxTurns ?? 3)],
    {
      cwd: ws.path,
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 300_000,
    },
  );

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const durationMs = Date.now() - start;

  const outcome = classify(stdout, exitCode);

  const entry: LogEntry = { ts, workspace: ws.path, outcome, durationMs };

  if (outcome === "attention") {
    entry.summary = stdout.slice(0, 200);
  } else if (outcome === "error") {
    entry.error = (stderr || stdout).slice(0, 200);
  }

  return entry;
}
