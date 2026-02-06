import { debug } from "../debug.ts";
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
    const piConfig = workspace as WorkspaceConfig & PiConfig;

    const piArgs = ["pi", "--mode=print"];

    // Add extensions
    if (piConfig.piExtensions && piConfig.piExtensions.length > 0) {
      for (const ext of piConfig.piExtensions) {
        piArgs.push("--extension", ext);
      }
    }

    // Add session for context reuse
    if (piConfig.piSession) {
      piArgs.push("--session", piConfig.piSession);
      piArgs.push("--reuse"); // Reuse session context
    }

    // Add model selection
    if (piConfig.piModel) {
      piArgs.push("--model", piConfig.piModel);
    }

    // Add max turns
    if (piConfig.maxTurns) {
      piArgs.push("--max-turns", String(piConfig.maxTurns));
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
      timeout: 300_000,
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
    try {
      const proc = Bun.spawn(["which", "pi"], {
        stdout: "pipe",
        stderr: "ignore",
      });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const proc = Bun.spawn(["pi", "--version"], {
        stdout: "pipe",
        stderr: "ignore",
      });
      const output = await new Response(proc.stdout).text();
      return output.trim() || null;
    } catch {
      return null;
    }
  }
}
