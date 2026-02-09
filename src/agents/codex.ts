import { debug } from "../debug.ts";
import { isCommandAvailable, getCommandVersion } from "./cli-utils.ts";
import { resolveTimeoutMs } from "./constants.ts";
import { streamPlainTextProcess } from "./plain-text-stream.ts";
import type { AgentAdapter, AgentExecutionResult, AgentStreamCallbacks } from "./adapter.ts";
import type { WorkspaceConfig, CodexConfig } from "../types.ts";

const VALID_SANDBOXES = ["read-only", "workspace-write", "danger-full-access"] as const;

/**
 * Validates Codex-specific configuration fields.
 * @throws Error if validation fails
 */
function validateCodexConfig(workspace: WorkspaceConfig): asserts workspace is CodexConfig {
  if (workspace.agent !== "codex") {
    throw new Error(`Expected agent 'codex', got: ${workspace.agent ?? "(unset)"}`);
  }

  if (workspace.model && typeof workspace.model !== "string") {
    throw new Error(`model must be a string, got: ${typeof workspace.model}`);
  }

  if (
    workspace.sandbox &&
    !VALID_SANDBOXES.includes(workspace.sandbox as (typeof VALID_SANDBOXES)[number])
  ) {
    throw new Error(
      `Invalid sandbox mode: "${workspace.sandbox}". Use: ${VALID_SANDBOXES.join(", ")}`,
    );
  }
}

/**
 * Agent adapter for OpenAI Codex CLI.
 *
 * Supports:
 * - Configurable sandbox policy (--sandbox)
 * - Network access toggle for workspace-write sandbox
 * - Model selection (--model)
 * - Configurable timeout
 *
 * Limitations vs Claude Code:
 * - No --max-turns equivalent (Codex manages turns internally)
 * - No permission deny-list (Codex uses sandbox policies for containment)
 * - Plain text output only (no structured stream-json)
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

    if (workspace.maxTurns) {
      debug("[codex] Warning: maxTurns is not supported by Codex CLI and will be ignored");
    }
    if (workspace.permissions && workspace.permissions !== "skip") {
      debug(
        "[codex] Warning: permissions.deny is not supported by Codex CLI — use sandbox mode instead",
      );
    }

    const sandbox = workspace.sandbox ?? "workspace-write";
    // Note: --full-auto is intentionally NOT used — it hardcodes --sandbox workspace-write,
    // overriding the user's explicit sandbox choice. Codex auto-sets approval to "never"
    // when reading from stdin (-), so --full-auto is unnecessary.
    const codexArgs = ["codex", "exec", "--sandbox", sandbox, "--skip-git-repo-check"];

    if (workspace.networkAccess && sandbox === "workspace-write") {
      codexArgs.push("-c", "sandbox_workspace_write.network_access=true");
    }

    if (workspace.model) {
      codexArgs.push("--model", workspace.model);
    }

    // Tell codex to read prompt from stdin
    codexArgs.push("-");

    debug(`[codex] Spawning: ${codexArgs.join(" ")} (cwd: ${workspace.path})`);

    const proc = Bun.spawn(codexArgs, {
      cwd: workspace.path,
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: resolveTimeoutMs(workspace),
    });

    return streamPlainTextProcess(proc, "codex", start, callbacks);
  }

  async isAvailable(): Promise<boolean> {
    return isCommandAvailable("codex");
  }

  async getVersion(): Promise<string | null> {
    return getCommandVersion("codex", "--version");
  }
}
