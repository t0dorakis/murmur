import { basename, join } from "node:path";
import { debug } from "./debug.ts";
import { getDataDir, ensureDataDir } from "./config.ts";
import { buildDisallowedToolsArgs } from "./permissions.ts";
import { createStreamProcessor } from "./stream-parser.ts";
import type {
  ConversationTurn,
  DaemonEvent,
  LogEntry,
  Outcome,
  ToolCall,
  WorkspaceConfig,
} from "./types.ts";

export type HeartbeatOptions = {
  verbose?: boolean;
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

/** Save the full conversation JSON to ~/.murmur/last-beat-{workspace}.json */
async function saveConversationLog(
  workspace: string,
  turns: ConversationTurn[],
): Promise<string> {
  ensureDataDir();
  const slug = basename(workspace).replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = join(getDataDir(), `last-beat-${slug}.json`);
  await Bun.write(filePath, JSON.stringify(turns, null, 2) + "\n");
  debug(`Saved conversation log to ${filePath}`);
  return filePath;
}

export async function runHeartbeat(
  ws: WorkspaceConfig,
  emit?: (event: DaemonEvent) => void,
  options?: HeartbeatOptions,
): Promise<LogEntry> {
  const ts = new Date().toISOString();
  const start = Date.now();
  const verbose = options?.verbose ?? false;

  debug(`Heartbeat: ${ws.path} (verbose=${verbose})`);

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

  const disallowedTools = buildDisallowedToolsArgs(ws.permissions);
  const claudeArgs = [
    "claude",
    "--print",
    "--dangerously-skip-permissions",
    ...disallowedTools,
    "--max-turns",
    String(ws.maxTurns ?? 99),
  ];

  // In verbose mode, use stream-json to capture tool calls and reasoning.
  // The Claude CLI requires --verbose alongside --print --output-format=stream-json.
  if (verbose) {
    claudeArgs.push("--verbose", "--output-format", "stream-json");
  }

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

  // Set up stream processor for verbose mode
  const streamProcessor = verbose
    ? createStreamProcessor({
        onToolCall: (toolCall: ToolCall) => {
          emit?.({ type: "heartbeat:tool-call", workspace: ws.path, toolCall });
        },
        onAssistantText: (text: string) => {
          emit?.({ type: "heartbeat:stdout", workspace: ws.path, chunk: text });
        },
      })
    : null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    stdout += chunk;

    if (streamProcessor) {
      streamProcessor.write(chunk);
    } else {
      emit?.({ type: "heartbeat:stdout", workspace: ws.path, chunk });
    }
  }

  // Flush any remaining buffered data
  streamProcessor?.flush();

  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  const durationMs = Date.now() - start;

  debug(`Claude exit code: ${exitCode}`);
  debug(`Claude stderr: ${stderr.trim() || "(empty)"}`);

  let resultText: string;
  let turns: ConversationTurn[] | undefined;

  if (verbose && streamProcessor) {
    const parsed = streamProcessor.result();
    resultText = parsed.resultText;
    turns = parsed.turns;
    debug(`Parsed ${turns.length} conversation turns`);
    if (parsed.costUsd != null) debug(`Cost: $${parsed.costUsd.toFixed(6)}`);
    if (parsed.numTurns != null) debug(`Agent turns: ${parsed.numTurns}`);

    // Log raw stream output at debug level (truncated)
    debug(`Stream JSON (first 500 chars): ${stdout.slice(0, 500)}`);
  } else {
    resultText = stdout;
    debug(`Claude stdout: ${resultText.trim() || "(empty)"}`);
  }

  const outcome = classify(resultText, exitCode);
  debug(`Outcome: ${outcome} (exit=${exitCode}, contains HEARTBEAT_OK=${resultText.includes("HEARTBEAT_OK")})`);
  debug(`Duration: ${durationMs}ms`);

  const entry: LogEntry = { ts, workspace: ws.path, outcome, durationMs };

  if (outcome === "attention") {
    entry.summary = resultText.slice(0, 200);
  } else if (outcome === "error") {
    entry.error = (stderr || resultText).slice(0, 200);
  }

  // Attach conversation turns when in verbose mode
  if (verbose && turns && turns.length > 0) {
    entry.turns = turns;
    // Also save the full conversation to a dedicated file
    try {
      await saveConversationLog(ws.path, turns);
    } catch (err) {
      debug(`Warning: failed to save conversation log: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  emit?.({ type: "heartbeat:done", workspace: ws.path, entry });
  return entry;
}
