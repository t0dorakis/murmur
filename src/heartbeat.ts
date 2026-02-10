import { join } from "node:path";
import { debug } from "./debug.ts";
import { getDataDir, ensureDataDir } from "./config.ts";
import { heartbeatDisplayName, heartbeatFilePath, heartbeatId } from "./discovery.ts";
import { parseFrontmatter, type FrontmatterResult } from "./frontmatter.ts";
import { getAdapter } from "./agents/index.ts";
import { recordActiveBeat, removeActiveBeat } from "./active-beats.ts";
import type { ConversationTurn, DaemonEvent, LogEntry, Outcome, WorkspaceConfig } from "./types.ts";

export type HeartbeatOptions = {
  quiet?: boolean;
};

/** Read and parse a HEARTBEAT.md file, separating frontmatter from content. */
export async function readHeartbeatFile(ws: WorkspaceConfig): Promise<FrontmatterResult> {
  const hbPath = heartbeatFilePath(ws);
  const file = Bun.file(hbPath);
  if (!(await file.exists())) {
    throw new Error(`HEARTBEAT.md not found at ${hbPath}`);
  }
  const raw = await file.text();
  return parseFrontmatter(raw);
}

export async function buildPrompt(ws: WorkspaceConfig): Promise<string> {
  const { content } = await readHeartbeatFile(ws);
  return `You are a heartbeat agent. Follow the instructions below.

WORKSPACE: ${ws.path}
TIME: ${new Date().toISOString()}

---
${content}
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
  ws: WorkspaceConfig,
  start: number,
  error: unknown,
  emit?: (event: DaemonEvent) => void,
): LogEntry {
  const id = heartbeatId(ws);
  const entry: LogEntry = {
    ts,
    workspace: id,
    outcome: "error",
    durationMs: Date.now() - start,
    error: error instanceof Error ? error.message : String(error),
  };
  emit?.({ type: "heartbeat:done", workspace: id, entry });
  return entry;
}

/** Save the full conversation JSON to ~/.murmur/last-beat-{slug}.json */
async function saveConversationLog(
  ws: WorkspaceConfig,
  turns: ConversationTurn[],
): Promise<string> {
  ensureDataDir();
  const slug = heartbeatDisplayName(ws).replace(/[^a-zA-Z0-9_-]/g, "_");
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
  const id = heartbeatId(ws);

  debug(`[heartbeat] Starting: ${id} (quiet=${quiet})`);

  let prompt: string;
  try {
    prompt = await buildPrompt(ws);
    debug(`[heartbeat] HEARTBEAT.md: ${prompt.split("\n").length} lines`);
  } catch (err) {
    return createErrorEntry(ts, ws, start, err, emit);
  }

  emit?.({
    type: "heartbeat:start",
    workspace: id,
    promptPreview: promptPreview(prompt),
  });

  // Get the appropriate agent adapter
  const agentName = ws.agent ?? "claude-code";
  debug(`[heartbeat] Using agent: ${agentName}`);

  let adapter;
  try {
    adapter = getAdapter(agentName);
  } catch (err) {
    return createErrorEntry(ts, ws, start, err, emit);
  }

  // Check if the agent CLI is available before attempting execution
  const available = await adapter.isAvailable();
  if (!available) {
    const error = `Agent '${agentName}' CLI is not available. Please install it or check your PATH.`;
    return createErrorEntry(ts, ws, start, error, emit);
  }

  // Execute agent with callbacks (unless in quiet mode)
  let result;
  let pid: number | undefined;
  try {
    result = await adapter.execute(
      prompt,
      ws,
      quiet
        ? undefined
        : {
            onToolCall: (toolCall) => {
              emit?.({
                type: "heartbeat:tool-call",
                workspace: id,
                toolCall,
              });
            },
            onText: (text) => {
              emit?.({
                type: "heartbeat:stdout",
                workspace: id,
                chunk: text,
              });
            },
          },
    );

    // Record the PID for orphan detection
    pid = result.pid;
    if (pid) {
      await recordActiveBeat(id, pid, ws.path);
    }
  } catch (err) {
    // Clean up active beat record if we recorded it
    if (pid) {
      try {
        await removeActiveBeat(id);
      } catch (cleanupErr) {
        debug(
          `[heartbeat] Warning: failed to remove active beat after error: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
        );
      }
    }
    return createErrorEntry(ts, ws, start, err, emit);
  } finally {
    // Always remove active beat record when done
    if (pid) {
      try {
        await removeActiveBeat(id);
      } catch (cleanupErr) {
        debug(
          `[heartbeat] Warning: failed to remove active beat in finally block: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
        );
      }
    }
  }

  const { resultText, exitCode, stderr, turns, costUsd, numTurns } = result;

  debug(`[heartbeat] Agent turns: ${turns?.length ?? 0}`);
  if (costUsd != null) debug(`[heartbeat] Cost: $${costUsd.toFixed(6)}`);
  if (numTurns != null) debug(`[heartbeat] Num turns: ${numTurns}`);

  const outcome = classify(resultText, exitCode);
  debug(
    `[heartbeat] Outcome: ${outcome} (exit=${exitCode}, contains HEARTBEAT_OK=${resultText.includes("HEARTBEAT_OK")})`,
  );
  debug(`[heartbeat] Duration: ${result.durationMs}ms`);

  const entry: LogEntry = {
    ts,
    workspace: id,
    outcome,
    durationMs: result.durationMs,
  };

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
      await saveConversationLog(ws, turns);
    } catch (err) {
      debug(
        `[heartbeat] Warning: failed to save conversation log: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  emit?.({ type: "heartbeat:done", workspace: id, entry });
  return entry;
}
