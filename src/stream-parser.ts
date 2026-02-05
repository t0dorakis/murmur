/**
 * Parses Claude Code CLI `--output-format stream-json` NDJSON output using Effect Stream.
 */

import { Effect, Ref, Schema, Stream } from "effect";
import { debug } from "./debug.ts";
import type { ConversationTurn, ToolCall } from "./types.ts";

/** Raw content block from Claude's stream-json messages. */
const TextBlock = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
});

const ToolUseBlock = Schema.Struct({
  type: Schema.Literal("tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

const ToolResultContentItem = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
});

const ToolResultBlock = Schema.Struct({
  type: Schema.Literal("tool_result"),
  tool_use_id: Schema.String,
  content: Schema.optional(Schema.Union(Schema.String, Schema.Array(ToolResultContentItem))),
});

const ContentBlock = Schema.Union(TextBlock, ToolUseBlock, ToolResultBlock);
type ContentBlock = Schema.Schema.Type<typeof ContentBlock>;

/** Raw message envelope from stream-json. */
const SystemMessage = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("init"),
  session_id: Schema.String,
  tools: Schema.optional(Schema.Array(Schema.Unknown)),
});

const AssistantMessage = Schema.Struct({
  type: Schema.Literal("assistant"),
  message: Schema.Struct({ content: Schema.Array(ContentBlock) }),
});

const UserMessage = Schema.Struct({
  type: Schema.Literal("user"),
  message: Schema.Struct({ content: Schema.Array(ContentBlock) }),
});

const ResultMessage = Schema.Struct({
  type: Schema.Literal("result"),
  subtype: Schema.String,
  result: Schema.optional(Schema.String),
  total_cost_usd: Schema.optional(Schema.Number),
  duration_ms: Schema.optional(Schema.Number),
  num_turns: Schema.optional(Schema.Number),
});

const StreamMessage = Schema.Union(SystemMessage, AssistantMessage, UserMessage, ResultMessage);
type StreamMessage = Schema.Schema.Type<typeof StreamMessage>;

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
          const input = block.input as Record<string, unknown>;
          newState.pendingTools.set(block.id, { name: block.name, input, startMs: Date.now() });
          toolCalls.push({ name: block.name, input });
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
          if (pending) {
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
 * Parse a JSON line into a StreamMessage, returning null on failure.
 */
function parseLineToMessage(line: string): StreamMessage | null {
  try {
    const json = JSON.parse(line);
    const result = Schema.decodeUnknownSync(StreamMessage)(json);
    return result;
  } catch {
    debug(`Skipped malformed stream-json line: ${line.slice(0, 100)}${line.length > 100 ? "..." : ""}`);
    return null;
  }
}

/**
 * Create an Effect that builds a parse stream and returns both the event stream and a way to get the final result.
 * Uses Ref for safe state management.
 */
export function createParseStreamEffect(readable: ReadableStream<Uint8Array>) {
  return Effect.gen(function* () {
    const stateRef = yield* Ref.make(initialState);

    const eventStream = Stream.fromReadableStream(() => readable, (e) => e as Error).pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.filter((line) => line.trim().length > 0),
      Stream.map(parseLineToMessage),
      Stream.filter((msg): msg is StreamMessage => msg !== null),
      Stream.mapAccum(initialState, (state, msg) => {
        const [newState, events] = processMessage(state, msg);
        return [newState, { state: newState, events }];
      }),
      Stream.tap(({ state }) => Ref.set(stateRef, state)),
      Stream.flatMap(({ events }) => Stream.fromIterable(events)),
    );

    const getResult = Ref.get(stateRef).pipe(
      Effect.map((s): StreamParseResult => ({
        resultText: s.resultText,
        turns: s.turns,
        costUsd: s.costUsd,
        numTurns: s.numTurns,
      }))
    );

    return { stream: eventStream, getResult };
  });
}

/**
 * Create an Effect Stream that parses NDJSON and emits ParseEvents.
 * Accumulates state and returns final result when stream completes.
 * @deprecated Use createParseStreamEffect for better Effect integration
 */
export function createParseStream(readable: ReadableStream<Uint8Array>) {
  let finalState = initialState;

  const eventStream = Stream.fromReadableStream(() => readable, (e) => e as Error).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => line.trim().length > 0),
    Stream.map(parseLineToMessage),
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
    const msg = parseLineToMessage(line);
    if (!msg) continue;

    const [newState, events] = processMessage(state, msg);
    state = newState;

    // Fire handlers for events
    for (const event of events) {
      if (event.type === "tool-call") handlers?.onToolCall?.(event.toolCall);
      else if (event.type === "text") handlers?.onText?.(event.text);
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
 * Run the parse stream to completion as an Effect, calling handlers for each event.
 * Returns the final parse result.
 */
export function runParseStreamEffect(
  readable: ReadableStream<Uint8Array>,
  handlers?: {
    onToolCall?: (toolCall: ToolCall) => void;
    onText?: (text: string) => void;
  },
): Effect.Effect<StreamParseResult> {
  return Effect.gen(function* () {
    const { stream, getResult } = yield* createParseStreamEffect(readable);

    yield* stream.pipe(
      Stream.tap((event) =>
        Effect.sync(() => {
          if (event.type === "tool-call") handlers?.onToolCall?.(event.toolCall);
          else if (event.type === "text") handlers?.onText?.(event.text);
        }),
      ),
      Stream.runDrain,
    );

    return yield* getResult;
  });
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
  return Effect.runPromise(runParseStreamEffect(readable, handlers));
}
