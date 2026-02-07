import { basename, join } from "node:path";
import { debug } from "./debug.ts";
import { getDataDir, ensureDataDir } from "./config.ts";
import { getAdapter } from "./agents/index.ts";
import type {
  ConversationTurn,
  DaemonEvent,
  LogEntry,
  Outcome,
  WorkspaceConfig,
} from "./types.ts";

export type HeartbeatOptions = {
  quiet?: boolean;
};

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

This is a fresh session. You have no memory of previous runs. To persist state between heartbeats, read/write files in the workspace.

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

/** Helper to create error LogEntry and emit event */
function createErrorEntry(
  ts: string,
  workspace: string,
  start: number,
  error: unknown,
  emit?: (event: DaemonEvent) => void,
): LogEntry {
  const entry: LogEntry = {
    ts,
    workspace,
    outcome: "error",
    durationMs: Date.now() - start,
    error: error instanceof Error ? error.message : String(error),
  };
  emit?.({ type: "heartbeat:done", workspace, entry });
  return entry;
}

/** Save the full conversation JSON to ~/.murmur/last-beat-{workspace}.json */
async function saveConversationLog(
  workspace: string,
  turns: ConversationTurn[],
): Promise<string> {
  ensureDataDir();
  const slug = basename(workspace).replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = join(getDataDir(), `last-beat-${slug}.json`);
  await Bun.write(filePath, JSON.stringify(turns, null, 2) + "\n");
  debug(`[heartbeat] Saved conversation log to ${filePath}`);
  return filePath;
}

export async function runHeartbeat(
  ws: WorkspaceConfig,
  emit?: (event: DaemonEvent) => void,
  options?: HeartbeatOptions,
): Promise<LogEntry> {
  const ts = new Date().toISOString();
  const start = Date.now();
  const quiet = options?.quiet ?? false;

  debug(`[heartbeat] Starting: ${ws.path} (quiet=${quiet})`);

  let prompt: string;
  try {
    prompt = await buildPrompt(ws);
    debug(`[heartbeat] HEARTBEAT.md: ${prompt.split("\n").length} lines`);
  } catch (err) {
    return createErrorEntry(ts, ws.path, start, err, emit);
  }

  emit?.({
    type: "heartbeat:start",
    workspace: ws.path,
    promptPreview: promptPreview(prompt),
  });

  // Get the appropriate agent adapter
  const agentName = ws.agent ?? "claude-code";
  debug(`[heartbeat] Using agent: ${agentName}`);

  let adapter;
  try {
    adapter = getAdapter(agentName);
  } catch (err) {
    return createErrorEntry(ts, ws.path, start, err, emit);
  }

  // Check if the agent CLI is available before attempting execution
  const available = await adapter.isAvailable();
  if (!available) {
    const error = `Agent '${agentName}' CLI is not available. Please install it or check your PATH.`;
    return createErrorEntry(ts, ws.path, start, error, emit);
  }

  // Execute agent with callbacks (unless in quiet mode)
  let result;
  try {
    result = await adapter.execute(
      prompt,
      ws,
      quiet
        ? undefined
        : {
            onToolCall: (toolCall) => {
              emit?.({ type: "heartbeat:tool-call", workspace: ws.path, toolCall });
            },
            onText: (text) => {
              emit?.({ type: "heartbeat:stdout", workspace: ws.path, chunk: text });
            },
          },
    );
  } catch (err) {
    return createErrorEntry(ts, ws.path, start, err, emit);
  }

  const { resultText, exitCode, stderr, turns, costUsd, numTurns } = result;

  debug(`[heartbeat] Agent turns: ${turns?.length ?? 0}`);
  if (costUsd != null) debug(`[heartbeat] Cost: $${costUsd.toFixed(6)}`);
  if (numTurns != null) debug(`[heartbeat] Num turns: ${numTurns}`);

  const outcome = classify(resultText, exitCode);
  debug(`[heartbeat] Outcome: ${outcome} (exit=${exitCode}, contains HEARTBEAT_OK=${resultText.includes("HEARTBEAT_OK")})`);
  debug(`[heartbeat] Duration: ${result.durationMs}ms`);

  const entry: LogEntry = { ts, workspace: ws.path, outcome, durationMs: result.durationMs };

  if (outcome === "attention") {
    entry.summary = resultText.slice(0, 200);
  } else if (outcome === "error") {
    entry.error = (stderr || resultText).slice(0, 200);
  }

  // Attach conversation turns when available
  if (turns && turns.length > 0) {
    entry.turns = turns;
    // Also save the full conversation to a dedicated file
    try {
      await saveConversationLog(ws.path, turns);
    } catch (err) {
      debug(`[heartbeat] Warning: failed to save conversation log: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  emit?.({ type: "heartbeat:done", workspace: ws.path, entry });
  return entry;
}
