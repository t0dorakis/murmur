import { debug, truncateForLog } from "../debug.ts";
import { buildDisallowedToolsArgs } from "../permissions.ts";
import { runParseStream } from "../stream-parser.ts";
import { isCommandAvailable, getCommandVersion } from "./cli-utils.ts";
import { DEFAULT_MAX_TURNS, resolveTimeoutMs } from "./constants.ts";
import type { AgentAdapter, AgentExecutionResult, AgentStreamCallbacks } from "./adapter.ts";
import type { WorkspaceConfig } from "../types.ts";

/**
 * Agent adapter for Claude Code (Anthropic's official CLI).
 *
 * Supports:
 * - stream-json output format for tool calls and reasoning
 * - Permission deny-list system
 * - Max turns configuration
 * - Verbose logging
 */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "claude-code";

  async execute(
    prompt: string,
    workspace: WorkspaceConfig,
    callbacks?: AgentStreamCallbacks,
  ): Promise<AgentExecutionResult> {
    const start = Date.now();

    const disallowedTools = buildDisallowedToolsArgs(workspace.permissions);
    const claudeArgs = [
      "claude",
      "--print",
      "--dangerously-skip-permissions",
      ...disallowedTools,
      "--max-turns",
      String(workspace.maxTurns ?? DEFAULT_MAX_TURNS),
      "--verbose",
      "--output-format",
      "stream-json",
    ];

    if (workspace.model) {
      claudeArgs.push("--model", workspace.model);
    }

    debug(`[claude-code] Spawning: ${claudeArgs.join(" ")} (cwd: ${workspace.path})`);

    const proc = Bun.spawn(claudeArgs, {
      cwd: workspace.path,
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: resolveTimeoutMs(workspace),
    });

    const pid = proc.pid;
    debug(`[claude-code] Spawned process PID: ${pid}`);

    if (!proc.stdout) throw new Error("Spawned process stdout is not piped");
    const stream = proc.stdout as ReadableStream<Uint8Array>;

    // Drain stderr immediately to prevent pipe buffer deadlock
    const stderrPromise = new Response(proc.stderr).text();

    // Tee stream: one for parsing, one for raw collection
    const [parseStream, rawStream] = stream.tee();

    let stdout = "";
    const rawPromise = new Response(rawStream).text().then((text) => {
      stdout = text;
    });

    // Parse stream; emit events if callbacks provided
    const parsed = await runParseStream(
      parseStream,
      callbacks
        ? {
            onToolCall: callbacks.onToolCall,
            onText: callbacks.onText,
          }
        : undefined,
    );

    await rawPromise;
    const resultText = parsed.resultText;
    const turns = parsed.turns;

    debug(`[claude-code] Parsed ${turns.length} conversation turns`);
    if (parsed.costUsd != null) debug(`[claude-code] Cost: $${parsed.costUsd.toFixed(6)}`);
    if (parsed.numTurns != null) debug(`[claude-code] Agent turns: ${parsed.numTurns}`);
    debug(`[claude-code] Stream JSON: ${truncateForLog(stdout, 500)}`);

    const exitCode = await proc.exited;
    const stderr = await stderrPromise;
    const durationMs = Date.now() - start;

    debug(`[claude-code] Exit code: ${exitCode}`);
    debug(`[claude-code] Stderr: ${stderr.trim() || "(empty)"}`);
    debug(`[claude-code] Duration: ${durationMs}ms`);

    return {
      resultText,
      exitCode,
      stderr,
      turns,
      costUsd: parsed.costUsd,
      numTurns: parsed.numTurns,
      durationMs,
      pid,
    };
  }

  async isAvailable(): Promise<boolean> {
    return isCommandAvailable("claude");
  }

  async getVersion(): Promise<string | null> {
    return getCommandVersion("claude", "--version");
  }
}
