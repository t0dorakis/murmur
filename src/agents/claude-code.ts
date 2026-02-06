import { debug } from "../debug.ts";
import { buildDisallowedToolsArgs } from "../permissions.ts";
import { runParseStream } from "../stream-parser.ts";
import type {
  AgentAdapter,
  AgentExecutionResult,
  AgentStreamCallbacks,
} from "./adapter.ts";
import type { WorkspaceConfig } from "../types.ts";

/** Default max turns when not specified in workspace config. */
const DEFAULT_MAX_TURNS = 99;

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

    debug(`[claude-code] Spawning: ${claudeArgs.join(" ")} (cwd: ${workspace.path})`);

    const proc = Bun.spawn(claudeArgs, {
      cwd: workspace.path,
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 300_000,
    });

    if (!proc.stdout) throw new Error("Spawned process stdout is not piped");
    const stream = proc.stdout as ReadableStream<Uint8Array>;

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
    debug(`[claude-code] Stream JSON (first 500 chars): ${stdout.slice(0, 500)}`);

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
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
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["which", "claude"], {
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
      const proc = Bun.spawn(["claude", "--version"], {
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
