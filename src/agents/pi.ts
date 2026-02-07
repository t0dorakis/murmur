import { debug } from "../debug.ts";
import { isCommandAvailable, getCommandVersion } from "./cli-utils.ts";
import { resolveTimeoutMs } from "./constants.ts";
import type {
  AgentAdapter,
  AgentExecutionResult,
  AgentStreamCallbacks,
} from "./adapter.ts";
import type { WorkspaceConfig, ConversationTurn, PiConfig } from "../types.ts";

/**
 * Validates Pi-specific configuration fields.
 * @throws Error if validation fails
 */
function validatePiConfig(workspace: WorkspaceConfig): asserts workspace is PiConfig {
  if (workspace.agent !== "pi") {
    throw new Error(`Expected agent 'pi', got: ${workspace.agent ?? "claude-code"}`);
  }

  if (workspace.model && typeof workspace.model !== "string") {
    throw new Error(
      `model must be a string, got: ${typeof workspace.model}`,
    );
  }

  if (workspace.session && typeof workspace.session !== "string") {
    throw new Error(
      `session must be a string, got: ${typeof workspace.session}`,
    );
  }
}

/**
 * Agent adapter for pi-mono (minimal coding agent by @badlogic).
 *
 * Supports:
 * - Print mode output (--mode=print)
 * - Session persistence (--session)
 * - Model selection (--model)
 * - Max turns configuration
 * - Configurable timeout
 *
 * Note: Pi uses simpler output format than Claude Code (plain text, no stream-json).
 * We parse the output to extract text and approximate conversation turns.
 */
export class PiAdapter implements AgentAdapter {
  readonly name = "pi";

  async execute(
    prompt: string,
    workspace: WorkspaceConfig,
    callbacks?: AgentStreamCallbacks,
  ): Promise<AgentExecutionResult> {
    const start = Date.now();

    // Validate pi-specific config (also narrows type to PiConfig)
    validatePiConfig(workspace);

    const piArgs = ["pi", "--mode=print"];

    // Add session for context reuse
    if (workspace.session) {
      piArgs.push("--session", workspace.session);
      piArgs.push("--reuse");
    }

    // Add model selection
    if (workspace.model) {
      piArgs.push("--model", workspace.model);
    }

    // Add max turns
    if (workspace.maxTurns) {
      piArgs.push("--max-turns", String(workspace.maxTurns));
    }

    // Add prompt as argument (pi accepts prompts via --prompt flag or stdin)
    // Using stdin for consistency with Claude Code approach
    piArgs.push("--prompt", "-"); // Read from stdin

    debug(`[pi] Spawning: ${piArgs.join(" ")} (cwd: ${workspace.path})`);

    const proc = Bun.spawn(piArgs, {
      cwd: workspace.path,
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: resolveTimeoutMs(workspace),
    });

    if (!proc.stdout) throw new Error("Spawned process stdout is not piped");

    // Pi outputs plain text, not stream-json
    // Stream stdout progressively for better TUI experience
    let stdout = "";

    const stdoutPromise = (async () => {
      const decoder = new TextDecoder();
      const reader = proc.stdout!.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          stdout += chunk;

          // Call onText callback with each chunk for real-time streaming
          // Protect against callback errors - don't let them break the stream
          if (callbacks?.onText && chunk) {
            try {
              callbacks.onText(chunk);
            } catch (callbackErr) {
              debug(`[pi] onText callback error: ${callbackErr instanceof Error ? callbackErr.message : String(callbackErr)}`);
              // Continue processing stream despite callback failure
            }
          }
        }
      } catch (readErr) {
        // Log read errors but still return accumulated stdout
        debug(`[pi] Stream read error: ${readErr instanceof Error ? readErr.message : String(readErr)}`);
        // Don't rethrow - let the function return partial output
      } finally {
        reader.releaseLock();
      }

      return stdout;
    })();

    const stderrPromise = new Response(proc.stderr).text();

    // Wait for streams to complete first, then get exit code
    const [finalStdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    const exitCode = await proc.exited;
    const durationMs = Date.now() - start;

    debug(`[pi] Exit code: ${exitCode}`);
    debug(`[pi] Stdout (first 500 chars): ${finalStdout.slice(0, 500)}`);
    debug(`[pi] Stderr: ${stderr.trim() || "(empty)"}`);
    debug(`[pi] Duration: ${durationMs}ms`);

    // Parse pi output to create conversation turn
    // Pi doesn't provide structured turn data, so we create a simplified single turn
    const turns: ConversationTurn[] = [{
      role: "result",
      text: finalStdout.trim(),
      durationMs,
    }];

    return {
      resultText: finalStdout.trim(),
      exitCode,
      stderr,
      turns,
      durationMs,
    };
  }

  async isAvailable(): Promise<boolean> {
    return isCommandAvailable("pi");
  }

  async getVersion(): Promise<string | null> {
    return getCommandVersion("pi", "--version");
  }
}
