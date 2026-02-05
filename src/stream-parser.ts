/**
 * Parses Claude Code CLI `--output-format stream-json` NDJSON output using Effect Stream.
 */

import { Effect, Stream } from "effect";
import { debug } from "./debug.ts";
import type { ConversationTurn, ToolCall } from "./types.ts";

/** Truncate a string for debug logging, adding ellipsis if truncated. */
function truncateForLog(text: string, maxLen = 100): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

/** Raw content block from Claude's stream-json messages. */
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content?: string | Array<{ type: string; text?: string }> };

/** Raw message envelope from stream-json. */
type StreamMessage =
  | { type: "system"; subtype: "init"; session_id: string; tools?: unknown[] }
  | { type: "assistant"; message: { content: ContentBlock[] } }
  | { type: "user"; message: { content: ContentBlock[] } }
  | { type: "result"; subtype: string; result?: string; total_cost_usd?: number; duration_ms?: number; num_turns?: number };

export type StreamParseResult = {
  resultText: string;
  turns: ConversationTurn[];
  costUsd?: number;
  numTurns?: number;
};

export type ParseEvent =
  | { type: "tool-call"; toolCall: ToolCall }
  | { type: "text"; text: string };

type ParserState = {
  turns: ConversationTurn[];
  pendingTools: Map<string, { name: string; input: Record<string, unknown>; startMs: number }>;
  resultText: string;
  costUsd?: number;
  numTurns?: number;
};

const initialState: ParserState = {
  turns: [],
  pendingTools: new Map(),
  resultText: "",
};

function extractToolOutput(content: string | Array<{ type: string; text?: string }> | undefined): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content.filter((b): b is { type: string; text: string } => b.type === "text" && typeof b.text === "string").map((b) => b.text);
    return texts.length > 0 ? texts.join("\n") : undefined;
  }
  return undefined;
}

function processMessage(state: ParserState, msg: StreamMessage): [ParserState, ParseEvent[]] {
  const events: ParseEvent[] = [];
  const newState = { ...state, pendingTools: new Map(state.pendingTools), turns: [...state.turns] };

  switch (msg.type) {
    case "assistant": {
      const textBlocks: string[] = [];
      const toolCalls: ToolCall[] = [];

      for (const block of msg.message?.content ?? []) {
        if (block.type === "text" && block.text) {
          textBlocks.push(block.text);
          events.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          newState.pendingTools.set(block.id, { name: block.name, input: block.input, startMs: Date.now() });
          toolCalls.push({ name: block.name, input: block.input });
        }
      }

      const turn: ConversationTurn = { role: "assistant" };
      if (textBlocks.length > 0) turn.text = textBlocks.join("");
      if (toolCalls.length > 0) turn.toolCalls = toolCalls;
      newState.turns.push(turn);
      break;
    }

    case "user": {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "tool_result" && block.tool_use_id) {
          const pending = newState.pendingTools.get(block.tool_use_id);
          if (!pending) {
            debug(`Warning: tool_result for unknown tool_use_id: ${block.tool_use_id}`);
            continue;
          }
          const output = extractToolOutput(block.content);
          const toolCall: ToolCall = {
            name: pending.name,
            input: pending.input,
            output,
            durationMs: Date.now() - pending.startMs,
          };
          events.push({ type: "tool-call", toolCall });
          newState.pendingTools.delete(block.tool_use_id);

          // Update the matching tool call in turns with output
          for (let i = newState.turns.length - 1; i >= 0; i--) {
            const t = newState.turns[i]!;
            if (t.role === "assistant" && t.toolCalls) {
              const match = t.toolCalls.find((tc) => tc.name === pending.name && !tc.output);
              if (match) {
                match.output = toolCall.output;
                match.durationMs = toolCall.durationMs;
                break;
              }
            }
          }
        }
      }
      break;
    }

    case "result": {
      newState.resultText = msg.result ?? "";
      newState.costUsd = msg.total_cost_usd;
      newState.numTurns = msg.num_turns;
      newState.turns.push({
        role: "result",
        text: newState.resultText,
        costUsd: newState.costUsd,
        durationMs: msg.duration_ms,
        numTurns: newState.numTurns,
      });
      break;
    }
  }

  return [newState, events];
}

/**
 * Create an Effect Stream that parses NDJSON and emits ParseEvents.
 * Accumulates state and returns final result when stream completes.
 */
export function createParseStream(readable: ReadableStream<Uint8Array>) {
  let finalState = initialState;

  const eventStream = Stream.fromReadableStream(() => readable, (e) => e as Error).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => line.trim().length > 0),
    Stream.map((line) => {
      try {
        return JSON.parse(line) as StreamMessage;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        debug(`Skipped malformed stream-json line (${errMsg}): ${truncateForLog(line)}`);
        return null;
      }
    }),
    Stream.filter((msg): msg is StreamMessage => msg !== null),
    Stream.mapAccum(initialState, (state, msg) => {
      const [newState, events] = processMessage(state, msg);
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
      costUsd: finalState.costUsd,
      numTurns: finalState.numTurns,
    }),
  };
}

/**
 * Parse NDJSON string directly (for testing and one-shot parsing).
 */
export function parseStreamJson(
  ndjson: string,
  handlers?: { onToolCall?: (tc: ToolCall) => void; onText?: (text: string) => void },
): StreamParseResult {
  const lines = ndjson.split("\n").filter((l) => l.trim());
  let state = initialState;

  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as StreamMessage;
      const [newState, events] = processMessage(state, msg);
      state = newState;

      // Fire handlers for events
      for (const event of events) {
        if (event.type === "tool-call") handlers?.onToolCall?.(event.toolCall);
        else if (event.type === "text") handlers?.onText?.(event.text);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      debug(`Skipped malformed stream-json line (${errMsg}): ${truncateForLog(line)}`);
      continue;
    }
  }

  return {
    resultText: state.resultText,
    turns: state.turns,
    costUsd: state.costUsd,
    numTurns: state.numTurns,
  };
}

/**
 * Run the parse stream to completion, calling handlers for each event.
 * Returns the final parse result.
 */
export async function runParseStream(
  readable: ReadableStream<Uint8Array>,
  handlers?: {
    onToolCall?: (toolCall: ToolCall) => void;
    onText?: (text: string) => void;
  },
): Promise<StreamParseResult> {
  const { stream, getResult } = createParseStream(readable);

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
