import { debug, truncateForLog } from "../debug.ts";
import type { AgentExecutionResult, AgentStreamCallbacks } from "./adapter.ts";
import type { ConversationTurn } from "../types.ts";
import type { ReadableSubprocess } from "bun";

/**
 * Stream stdout/stderr from a plain-text agent process, collecting output
 * and returning a unified AgentExecutionResult.
 *
 * Used by adapters that don't emit structured JSONL (e.g., Pi).
 * For structured stream-json output, see stream-parser.ts (used by Claude Code).
 */
export async function streamPlainTextProcess(
  proc: ReadableSubprocess,
  agentName: string,
  start: number,
  callbacks?: AgentStreamCallbacks,
): Promise<AgentExecutionResult> {
  const pid = proc.pid;
  debug(`[${agentName}] Spawned process PID: ${pid}`);
  callbacks?.onSpawn?.(pid);
  let stdout = "";
  let streamError: Error | null = null;

  const stdoutPromise = (async () => {
    const decoder = new TextDecoder();
    const reader = proc.stdout.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        stdout += chunk;

        if (callbacks?.onText && chunk) {
          try {
            callbacks.onText(chunk);
          } catch (callbackErr) {
            debug(
              `[${agentName}] onText callback error: ${callbackErr instanceof Error ? callbackErr.message : String(callbackErr)}`,
            );
          }
        }
      }
    } catch (readErr) {
      streamError = readErr instanceof Error ? readErr : new Error(String(readErr));
      debug(`[${agentName}] Stream read error: ${streamError.message}`);
    } finally {
      reader.releaseLock();
    }

    // Flush any remaining buffered bytes from the TextDecoder
    const remaining = decoder.decode();
    if (remaining) stdout += remaining;

    return stdout;
  })();

  const stderrPromise = new Response(proc.stderr).text();

  const [finalStdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  const exitCode = await proc.exited;
  const durationMs = Date.now() - start;

  debug(`[${agentName}] Exit code: ${exitCode}`);
  debug(`[${agentName}] Stdout: ${truncateForLog(finalStdout, 500)}`);
  debug(`[${agentName}] Stderr: ${stderr.trim() || "(empty)"}`);
  debug(`[${agentName}] Duration: ${durationMs}ms`);

  // Surface stream read errors so the caller (heartbeat.ts) can log them properly
  if (streamError) {
    throw new Error(
      `[${agentName}] Stream read failed after ${stdout.length} bytes: ${streamError.message}`,
    );
  }

  const turns: ConversationTurn[] = [
    {
      role: "result",
      text: finalStdout.trim(),
      durationMs,
    },
  ];

  return {
    resultText: finalStdout.trim(),
    exitCode,
    stderr,
    turns,
    durationMs,
    pid,
  };
}
