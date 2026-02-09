/**
 * Parses Codex CLI `--json` NDJSON output using Effect Stream.
 *
 * Codex emits ThreadEvent objects: thread.started, turn.started, turn.completed,
 * item.started, item.completed, etc. We extract tool calls and agent messages
 * from these events.
 */

import { Effect, Stream } from "effect";
import { debug, truncateForLog } from "./debug.ts";
import type { StreamParseResult, ParseEvent } from "./stream-parser.ts";
import type { ConversationTurn, ToolCall } from "./types.ts";

// -- Codex event types --

type AgentMessageItem = {
  id: string;
  type: "agent_message";
  text: string;
};

type CommandExecutionItem = {
  id: string;
  type: "command_execution";
  command: string;
  aggregated_output: string;
  exit_code?: number;
  status: string;
};

type FileChangeItem = {
  id: string;
  type: "file_change";
  changes: Array<{ path: string; kind: string }>;
  status: string;
};

type McpToolCallItem = {
  id: string;
  type: "mcp_tool_call";
  server: string;
  tool: string;
  arguments: unknown;
  result?: { content?: unknown[]; structured_content?: unknown };
  error?: { message: string };
  status: string;
};

type CodexItem = AgentMessageItem | CommandExecutionItem | FileChangeItem | McpToolCallItem;

type CodexUsage = {
  input_tokens: number;
  cached_input_tokens?: number;
  output_tokens: number;
};

type CodexEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | { type: "turn.completed"; usage: CodexUsage }
  | { type: "turn.failed"; error: { message: string } }
  | { type: "item.started"; item: CodexItem }
  | { type: "item.updated"; item: CodexItem }
  | { type: "item.completed"; item: CodexItem }
  | { type: "error"; message: string };

// -- Parser state --

type PendingItem = {
  id: string;
  startMs: number;
};

type ParserState = {
  turns: ConversationTurn[];
  pendingItems: Map<string, PendingItem>;
  resultText: string;
};

const initialState = (): ParserState => ({
  turns: [],
  pendingItems: new Map(),
  resultText: "",
});

/** Extract a readable output string from an MCP tool call result. */
function extractMcpOutput(item: McpToolCallItem): string | undefined {
  if (item.error) return `Error: ${item.error.message}`;
  if (!item.result?.content) return undefined;
  const texts = (item.result.content as Array<{ type?: string; text?: string }>)
    .filter(
      (b): b is { type: string; text: string } => b.type === "text" && typeof b.text === "string",
    )
    .map((b) => b.text);
  return texts.length > 0 ? texts.join("\n") : undefined;
}

function processEvent(state: ParserState, event: CodexEvent): [ParserState, ParseEvent[]] {
  switch (event.type) {
    case "turn.failed": {
      debug(`[codex] Turn failed: ${event.error.message}`);
      return [state, []];
    }

    case "error": {
      debug(`[codex] Thread error: ${event.message}`);
      return [state, []];
    }

    case "turn.completed":
    case "turn.started":
    case "thread.started":
    case "item.updated":
      return [state, []];

    default:
      break;
  }

  const events: ParseEvent[] = [];
  const newState: ParserState = {
    ...state,
    pendingItems: new Map(state.pendingItems),
    turns: [...state.turns],
  };

  switch (event.type) {
    case "item.started": {
      const item = event.item;
      if (
        item.type === "command_execution" ||
        item.type === "mcp_tool_call" ||
        item.type === "file_change"
      ) {
        newState.pendingItems.set(item.id, { id: item.id, startMs: Date.now() });
      }
      break;
    }

    case "item.completed": {
      const item = event.item;
      const pending = newState.pendingItems.get(item.id);
      const durationMs = pending ? Date.now() - pending.startMs : undefined;
      if (pending) newState.pendingItems.delete(item.id);

      switch (item.type) {
        case "agent_message": {
          if (item.text) {
            events.push({ type: "text", text: item.text });
            newState.turns.push({ role: "assistant", text: item.text });
            // Use the last agent_message as the result text
            newState.resultText = item.text;
          }
          break;
        }

        case "command_execution": {
          const toolCall: ToolCall = {
            name: "command",
            input: { command: item.command },
            output: item.aggregated_output,
            durationMs,
          };
          events.push({ type: "tool-call", toolCall });
          newState.turns.push({
            role: "assistant",
            toolCalls: [toolCall],
          });
          break;
        }

        case "mcp_tool_call": {
          if (typeof item.arguments !== "object" || item.arguments === null) {
            debug(
              `[codex] mcp_tool_call ${item.id}: unexpected arguments type: ${typeof item.arguments}`,
            );
          }
          const output = extractMcpOutput(item);
          const toolCall: ToolCall = {
            name: item.tool,
            input: (typeof item.arguments === "object" && item.arguments !== null
              ? item.arguments
              : {}) as Record<string, unknown>,
            output,
            durationMs,
          };
          events.push({ type: "tool-call", toolCall });
          newState.turns.push({
            role: "assistant",
            toolCalls: [toolCall],
          });
          break;
        }

        case "file_change": {
          const toolCall: ToolCall = {
            name: "file_change",
            input: { changes: item.changes },
            durationMs,
          };
          events.push({ type: "tool-call", toolCall });
          newState.turns.push({
            role: "assistant",
            toolCalls: [toolCall],
          });
          break;
        }
      }
      break;
    }
  }

  return [newState, events];
}

/**
 * Parse NDJSON string directly (for testing and one-shot parsing).
 */
export function parseCodexStream(
  ndjson: string,
  handlers?: {
    onToolCall?: (tc: ToolCall) => void;
    onText?: (text: string) => void;
  },
): StreamParseResult {
  const lines = ndjson.split("\n").filter((l) => l.trim());
  let state = initialState();

  for (const line of lines) {
    let event: CodexEvent;
    try {
      event = JSON.parse(line) as CodexEvent;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      debug(`Skipped malformed codex-json line (${errMsg}): ${truncateForLog(line)}`);
      continue;
    }

    const [newState, events] = processEvent(state, event);
    state = newState;

    for (const ev of events) {
      if (ev.type === "tool-call") handlers?.onToolCall?.(ev.toolCall);
      else if (ev.type === "text") handlers?.onText?.(ev.text);
    }
  }

  return {
    resultText: state.resultText,
    turns: state.turns,
  };
}

/**
 * Create an Effect Stream that parses Codex NDJSON and emits ParseEvents.
 */
export function createCodexParseStream(readable: ReadableStream<Uint8Array>) {
  let finalState = initialState();

  const eventStream = Stream.fromReadableStream(
    () => readable,
    (e) => e as Error,
  ).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => line.trim().length > 0),
    Stream.map((line) => {
      try {
        return JSON.parse(line) as CodexEvent;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        debug(`Skipped malformed codex-json line (${errMsg}): ${truncateForLog(line)}`);
        return null;
      }
    }),
    Stream.filter((event): event is CodexEvent => event !== null),
    Stream.mapAccum(initialState(), (state, event) => {
      const [newState, events] = processEvent(state, event);
      finalState = newState;
      return [newState, events];
    }),
    Stream.flatMap((events) => Stream.fromIterable(events)),
  );

  return {
    stream: eventStream,
    getResult: (): StreamParseResult => ({
      resultText: finalState.resultText,
      turns: finalState.turns,
    }),
  };
}

/**
 * Run the parse stream to completion, calling handlers for each event.
 * Returns the final parse result.
 */
export async function runCodexParseStream(
  readable: ReadableStream<Uint8Array>,
  handlers?: {
    onToolCall?: (toolCall: ToolCall) => void;
    onText?: (text: string) => void;
  },
): Promise<StreamParseResult> {
  const { stream, getResult } = createCodexParseStream(readable);

  const program = stream.pipe(
    Stream.tap((event) =>
      Effect.sync(() => {
        if (event.type === "tool-call") handlers?.onToolCall?.(event.toolCall);
        else if (event.type === "text") handlers?.onText?.(event.text);
      }),
    ),
    Stream.runDrain,
  );

  await Effect.runPromise(program);
  return getResult();
}
