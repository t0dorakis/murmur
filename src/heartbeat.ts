import { join } from "node:path";
import { debug } from "./debug.ts";
import type {
  DaemonEvent,
  LogEntry,
  Outcome,
  WorkspaceConfig,
} from "./types.ts";

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

export function promptPreview(prompt: string): string {
  const lines = prompt.split("\n").filter((l) => l.trim());
  return lines.slice(0, 3).join(" ").slice(0, 120);
}

export async function runHeartbeat(
  ws: WorkspaceConfig,
  emit?: (event: DaemonEvent) => void,
): Promise<LogEntry> {
  const ts = new Date().toISOString();
  const start = Date.now();

  debug(`Heartbeat: ${ws.path}`);

  let prompt: string;
  try {
    prompt = await buildPrompt(ws);
    debug(`HEARTBEAT.md: ${prompt.split("\n").length} lines`);
  } catch (err) {
    const entry: LogEntry = {
      ts,
      workspace: ws.path,
      outcome: "error",
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
    emit?.({ type: "heartbeat:done", workspace: ws.path, entry });
    return entry;
  }

  emit?.({
    type: "heartbeat:start",
    workspace: ws.path,
    promptPreview: promptPreview(prompt),
  });

  const claudeArgs = [
    "claude",
    "--print",
    "--dangerously-skip-permissions",
    "--max-turns",
    String(ws.maxTurns ?? 99),
  ];
  debug(`Spawning: ${claudeArgs.join(" ")} (cwd: ${ws.path})`);

  const proc = Bun.spawn(claudeArgs, {
    cwd: ws.path,
    stdin: new Blob([prompt]),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 300_000,
  });

  let stdout = "";
  if (!proc.stdout) throw new Error("Spawned process stdout is not piped");
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    stdout += chunk;
    emit?.({ type: "heartbeat:stdout", workspace: ws.path, chunk });
  }

  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  const durationMs = Date.now() - start;

  debug(`Claude stdout: ${stdout.trim() || "(empty)"}`);
  debug(`Claude stderr: ${stderr.trim() || "(empty)"}`);

  const outcome = classify(stdout, exitCode);
  debug(`Outcome: ${outcome} (exit=${exitCode}, contains HEARTBEAT_OK=${stdout.includes("HEARTBEAT_OK")})`);
  debug(`Duration: ${durationMs}ms`);

  const entry: LogEntry = { ts, workspace: ws.path, outcome, durationMs };

  if (outcome === "attention") {
    entry.summary = stdout.slice(0, 200);
  } else if (outcome === "error") {
    entry.error = (stderr || stdout).slice(0, 200);
  }

  emit?.({ type: "heartbeat:done", workspace: ws.path, entry });
  return entry;
}
