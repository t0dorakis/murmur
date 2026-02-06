import { debug } from "../debug.ts";
import { isCommandAvailable, getCommandVersion } from "./cli-utils.ts";
import { DEFAULT_AGENT_TIMEOUT_MS } from "./constants.ts";
import type {
  AgentAdapter,
  AgentExecutionResult,
  AgentStreamCallbacks,
} from "./adapter.ts";
import type { WorkspaceConfig, ConversationTurn } from "../types.ts";

/**
 * Pi-specific configuration options.
 */
export type PiConfig = {
  /** Pi extensions to load (e.g., "@mariozechner/pi-browser") */
  piExtensions?: string[];
  /** Session ID for context reuse across heartbeats */
  piSession?: string;
  /** Model/provider to use (e.g., "anthropic/claude-sonnet-4.5") */
  piModel?: string;
  /** Max turns (pi uses --max-turns flag) */
  maxTurns?: number;
};

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

    // Validate pi-specific config
    if (workspace.piExtensions) {
      if (!Array.isArray(workspace.piExtensions)) {
        throw new Error(
          `piExtensions must be an array, got: ${typeof workspace.piExtensions}`,
        );
      }
      for (const ext of workspace.piExtensions) {
        if (typeof ext !== "string" || !ext.trim()) {
          throw new Error(`piExtension must be a non-empty string, got: ${ext}`);
        }
      }
    }

    if (workspace.piModel && typeof workspace.piModel !== "string") {
      throw new Error(
        `piModel must be a string, got: ${typeof workspace.piModel}`,
      );
    }

    if (workspace.piSession && typeof workspace.piSession !== "string") {
      throw new Error(
        `piSession must be a string, got: ${typeof workspace.piSession}`,
      );
    }

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
    // We'll collect the output and parse it for HEARTBEAT_OK/ATTENTION markers
    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();

    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    const exitCode = await proc.exited;
    const durationMs = Date.now() - start;

    debug(`[pi] Exit code: ${exitCode}`);
    debug(`[pi] Stdout (first 500 chars): ${stdout.slice(0, 500)}`);
    debug(`[pi] Stderr: ${stderr.trim() || "(empty)"}`);
    debug(`[pi] Duration: ${durationMs}ms`);

    // Stream callbacks (if provided)
    // Since we're collecting output after completion, we can only callback with final text
    if (callbacks?.onText) {
      callbacks.onText(stdout);
    }

    // Parse pi output to approximate conversation turns
    // Pi doesn't provide structured turn data, so we create a simplified version
    const turns: ConversationTurn[] = [];

    if (stdout.trim()) {
      turns.push({
        role: "assistant",
        text: stdout.trim(),
      });
    }

    turns.push({
      role: "result",
      text: stdout.trim(),
      durationMs,
    });

    return {
      resultText: stdout.trim(),
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
