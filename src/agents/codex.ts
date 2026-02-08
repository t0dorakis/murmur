import { debug } from "../debug.ts";
import { isCommandAvailable, getCommandVersion } from "./cli-utils.ts";
import { resolveTimeoutMs } from "./constants.ts";
import type { AgentAdapter, AgentExecutionResult, AgentStreamCallbacks } from "./adapter.ts";
import type { WorkspaceConfig, ConversationTurn, CodexConfig } from "../types.ts";

/**
 * Validates Codex-specific configuration fields.
 * @throws Error if validation fails
 */
function validateCodexConfig(workspace: WorkspaceConfig): asserts workspace is CodexConfig {
  if (workspace.agent !== "codex") {
    throw new Error(`Expected agent 'codex', got: ${workspace.agent ?? "claude-code"}`);
  }

  if (workspace.model && typeof workspace.model !== "string") {
    throw new Error(`model must be a string, got: ${typeof workspace.model}`);
  }
}

/**
 * Agent adapter for OpenAI Codex CLI.
 *
 * Supports:
 * - Full-auto execution mode (--full-auto)
 * - Sandboxed workspace writes (--sandbox workspace-write)
 * - Model selection (--model)
 * - Configurable timeout
 *
 * Note: Codex uses plain text output (no stream-json).
 * We parse the output to create a synthetic conversation turn.
 */
export class CodexAdapter implements AgentAdapter {
  readonly name = "codex";

  async execute(
    prompt: string,
    workspace: WorkspaceConfig,
    callbacks?: AgentStreamCallbacks,
  ): Promise<AgentExecutionResult> {
    const start = Date.now();

    validateCodexConfig(workspace);

    const codexArgs = [
      "codex",
      "exec",
      "--full-auto",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
    ];

    if (workspace.model) {
      codexArgs.push("--model", workspace.model);
    }

    // Read prompt from stdin
    codexArgs.push("-");

    debug(`[codex] Spawning: ${codexArgs.join(" ")} (cwd: ${workspace.path})`);

    const proc = Bun.spawn(codexArgs, {
      cwd: workspace.path,
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: resolveTimeoutMs(workspace),
    });

    if (!proc.stdout) throw new Error("Spawned process stdout is not piped");

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

          if (callbacks?.onText && chunk) {
            try {
              callbacks.onText(chunk);
            } catch (callbackErr) {
              debug(
                `[codex] onText callback error: ${callbackErr instanceof Error ? callbackErr.message : String(callbackErr)}`,
              );
            }
          }
        }
      } catch (readErr) {
        debug(
          `[codex] Stream read error: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
        );
      } finally {
        reader.releaseLock();
      }

      return stdout;
    })();

    const stderrPromise = new Response(proc.stderr).text();

    const [finalStdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    const exitCode = await proc.exited;
    const durationMs = Date.now() - start;

    debug(`[codex] Exit code: ${exitCode}`);
    debug(`[codex] Stdout (first 500 chars): ${finalStdout.slice(0, 500)}`);
    debug(`[codex] Stderr: ${stderr.trim() || "(empty)"}`);
    debug(`[codex] Duration: ${durationMs}ms`);

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
    };
  }

  async isAvailable(): Promise<boolean> {
    return isCommandAvailable("codex");
  }

  async getVersion(): Promise<string | null> {
    return getCommandVersion("codex", "--version");
  }
}
