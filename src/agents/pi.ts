import { debug } from "../debug.ts";
import { isCommandAvailable, getCommandVersion } from "./cli-utils.ts";
import { DEFAULT_AGENT_TIMEOUT_MS } from "./constants.ts";
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
  // Type narrow to PiConfig
  const piWorkspace = workspace as PiConfig;

  if (piWorkspace.piExtensions) {
    if (!Array.isArray(piWorkspace.piExtensions)) {
      throw new Error(
        `piExtensions must be an array, got: ${typeof piWorkspace.piExtensions}`,
      );
    }
    for (const ext of piWorkspace.piExtensions) {
      if (typeof ext !== "string" || !ext.trim()) {
        throw new Error(`piExtension must be a non-empty string, got: ${ext}`);
      }
    }
  }

  if (piWorkspace.piModel && typeof piWorkspace.piModel !== "string") {
    throw new Error(
      `piModel must be a string, got: ${typeof piWorkspace.piModel}`,
    );
  }

  if (piWorkspace.piSession && typeof piWorkspace.piSession !== "string") {
    throw new Error(
      `piSession must be a string, got: ${typeof piWorkspace.piSession}`,
    );
  }
}

/**
 * Agent adapter for pi-mono (minimal coding agent by @badlogic).
 *
 * Supports:
 * - Print mode output (--mode=print)
 * - Extension loading (--extension)
 * - Session persistence (--session)
 * - Model selection (--model)
 * - Max turns configuration
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

    // Add extensions
    if (workspace.piExtensions && workspace.piExtensions.length > 0) {
      for (const ext of workspace.piExtensions) {
        piArgs.push("--extension", ext);
      }
    }

    // Add session for context reuse
    if (workspace.piSession) {
      piArgs.push("--session", workspace.piSession);
      piArgs.push("--reuse"); // Reuse session context
    }

    // Add model selection
    if (workspace.piModel) {
      piArgs.push("--model", workspace.piModel);
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
      timeout: DEFAULT_AGENT_TIMEOUT_MS,
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
          if (callbacks?.onText && chunk) {
            callbacks.onText(chunk);
          }
        }
      } finally {
        reader.releaseLock();
      }

      return stdout;
    })();

    const stderrPromise = new Response(proc.stderr).text();

    const [finalStdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    const exitCode = await proc.exited;
    const durationMs = Date.now() - start;

    debug(`[pi] Exit code: ${exitCode}`);
    debug(`[pi] Stdout (first 500 chars): ${finalStdout.slice(0, 500)}`);
    debug(`[pi] Stderr: ${stderr.trim() || "(empty)"}`);
    debug(`[pi] Duration: ${durationMs}ms`);

    // Parse pi output to approximate conversation turns
    // Pi doesn't provide structured turn data, so we create a simplified version
    const turns: ConversationTurn[] = [];

    if (finalStdout.trim()) {
      turns.push({
        role: "assistant",
        text: finalStdout.trim(),
      });
    }

    turns.push({
      role: "result",
      text: finalStdout.trim(),
      durationMs,
    });

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
