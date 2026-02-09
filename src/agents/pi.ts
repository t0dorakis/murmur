import { debug } from "../debug.ts";
import { isCommandAvailable, getCommandVersion } from "./cli-utils.ts";
import { resolveTimeoutMs } from "./constants.ts";
import { streamPlainTextProcess } from "./plain-text-stream.ts";
import type { AgentAdapter, AgentExecutionResult, AgentStreamCallbacks } from "./adapter.ts";
import type { WorkspaceConfig, PiConfig } from "../types.ts";

/**
 * Validates Pi-specific configuration fields.
 * @throws Error if validation fails
 */
function validatePiConfig(workspace: WorkspaceConfig): asserts workspace is PiConfig {
  if (workspace.agent !== "pi") {
    throw new Error(`Expected agent 'pi', got: ${workspace.agent ?? "(unset)"}`);
  }

  if (workspace.model && typeof workspace.model !== "string") {
    throw new Error(`model must be a string, got: ${typeof workspace.model}`);
  }

  if (workspace.session && typeof workspace.session !== "string") {
    throw new Error(`session must be a string, got: ${typeof workspace.session}`);
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
 * Plain text output — uses shared streamPlainTextProcess for stdout collection.
 */
export class PiAdapter implements AgentAdapter {
  readonly name = "pi";

  async execute(
    prompt: string,
    workspace: WorkspaceConfig,
    callbacks?: AgentStreamCallbacks,
  ): Promise<AgentExecutionResult> {
    const start = Date.now();

    validatePiConfig(workspace);

    const piArgs = ["pi", "--mode=print"];

    if (workspace.session) {
      piArgs.push("--session", workspace.session);
      piArgs.push("--reuse");
    }

    if (workspace.model) {
      piArgs.push("--model", workspace.model);
    }

    if (workspace.maxTurns) {
      piArgs.push("--max-turns", String(workspace.maxTurns));
    }

    piArgs.push("--prompt", "-");

    debug(`[pi] Spawning: ${piArgs.join(" ")} (cwd: ${workspace.path})`);

    const proc = Bun.spawn(piArgs, {
      cwd: workspace.path,
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: resolveTimeoutMs(workspace),
    });

    return streamPlainTextProcess(proc, "pi", start, callbacks);
  }

  async isAvailable(): Promise<boolean> {
    return isCommandAvailable("pi");
  }

  async getVersion(): Promise<string | null> {
    return getCommandVersion("pi", "--version");
  }
}
