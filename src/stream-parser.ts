/**
 * Parses Claude Code CLI `--output-format stream-json` NDJSON output using Effect Stream.
 */

import { Effect, Either, Ref, Schema, Stream } from "effect";
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

/** Convert parser state to result format. */
function stateToResult(state: ParserState): StreamParseResult {
  return {
    resultText: state.resultText,
    turns: state.turns,
    costUsd: state.costUsd,
    numTurns: state.numTurns,
  };
}

/** Update pending tool call in turns with output and duration. */
function updatePendingToolCallInTurns(
  turns: ConversationTurn[],
  toolName: string,
  output: string | undefined,
  durationMs: number,
): void {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (!turn || turn.role !== "assistant" || !turn.toolCalls) continue;

    const pendingCall = turn.toolCalls.find((tc) => tc.name === toolName && !tc.output);
    if (pendingCall) {
      pendingCall.output = output;
      pendingCall.durationMs = durationMs;
      return;
    }
  }
}

/** Dispatch event to appropriate handler. */
function dispatchEvent(
  event: ParseEvent,
  handlers?: { onToolCall?: (tc: ToolCall) => void; onText?: (text: string) => void },
): void {
  if (!handlers) return;
  switch (event.type) {
    case "tool-call":
      handlers.onToolCall?.(event.toolCall);
      break;
    case "text":
      handlers.onText?.(event.text);
      break;
  }
}

/** Process an assistant message, extracting text and tool calls. */
function processAssistantMessage(
  state: ParserState,
  msg: Schema.Schema.Type<typeof AssistantMessage>,
): [ParserState, ParseEvent[]] {
  const events: ParseEvent[] = [];
  const newState = { ...state, pendingTools: new Map(state.pendingTools), turns: [...state.turns] };
  const textBlocks: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of msg.message.content) {
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

  return [newState, events];
}

/** Process a user message, matching tool results to pending tool calls. */
function processUserMessage(
  state: ParserState,
  msg: Schema.Schema.Type<typeof UserMessage>,
): [ParserState, ParseEvent[]] {
  const events: ParseEvent[] = [];
  const newState = { ...state, pendingTools: new Map(state.pendingTools), turns: [...state.turns] };

  for (const block of msg.message.content) {
    if (block.type !== "tool_result" || !block.tool_use_id) continue;

    const pending = newState.pendingTools.get(block.tool_use_id);
    if (!pending) {
      debug(`Received tool_result for unknown tool_use_id: ${block.tool_use_id}`);
      continue;
    }

    const output = extractToolOutput(block.content);
    const durationMs = Date.now() - pending.startMs;
    const toolCall: ToolCall = {
      name: pending.name,
      input: pending.input,
      output,
      durationMs,
    };
    events.push({ type: "tool-call", toolCall });
    newState.pendingTools.delete(block.tool_use_id);

    updatePendingToolCallInTurns(newState.turns, pending.name, output, durationMs);
  }

  return [newState, events];
}

/** Process a result message, capturing final output and metadata. */
function processResultMessage(
  state: ParserState,
  msg: Schema.Schema.Type<typeof ResultMessage>,
): [ParserState, ParseEvent[]] {
  const newState = { ...state, turns: [...state.turns] };

  if (msg.result === undefined) {
    debug("Result message has no result text - this may indicate an API change");
  }
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

  return [newState, []];
}

function processMessage(state: ParserState, msg: StreamMessage): [ParserState, ParseEvent[]] {
  switch (msg.type) {
    case "assistant":
      return processAssistantMessage(state, msg);
    case "user":
      return processUserMessage(state, msg);
    case "result":
      return processResultMessage(state, msg);
    case "system":
      return [state, []];
  }
}

const decodeStreamMessage = Schema.decodeUnknownEither(StreamMessage);

/**
 * Parse a JSON line into a StreamMessage, returning null on failure.
 * Uses Either to distinguish parse errors from schema validation errors.
 */
function parseLineToMessage(line: string): StreamMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch (e) {
    debug(`Skipped non-JSON line: ${line.slice(0, 100)}${line.length > 100 ? "..." : ""}`);
    return null;
  }

  const decoded = decodeStreamMessage(json);
  if (Either.isLeft(decoded)) {
    debug(`Schema validation failed: ${line.slice(0, 100)}${line.length > 100 ? "..." : ""}`);
    return null;
  }
  return decoded.right;
}

/** Create base message stream from readable, handling text decoding and line splitting. */
function createMessageStream(readable: ReadableStream<Uint8Array>) {
  return Stream.fromReadableStream(() => readable, (e) => e as Error).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => line.trim().length > 0),
    Stream.map(parseLineToMessage),
    Stream.filter((msg): msg is StreamMessage => msg !== null),
  );
}

/**
 * Create an Effect that builds a parse stream and returns both the event stream and a way to get the final result.
 * Uses Ref for safe state management.
 */
export function createParseStreamEffect(readable: ReadableStream<Uint8Array>) {
  return Effect.gen(function* () {
    const stateRef = yield* Ref.make(initialState);

    const eventStream = createMessageStream(readable).pipe(
      Stream.mapAccum(initialState, (state, msg) => {
        const [newState, events] = processMessage(state, msg);
        return [newState, { state: newState, events }];
      }),
      Stream.tap(({ state }) => Ref.set(stateRef, state)),
      Stream.flatMap(({ events }) => Stream.fromIterable(events)),
    );

    const getResult = Ref.get(stateRef).pipe(Effect.map(stateToResult));

    return { stream: eventStream, getResult };
  });
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

    for (const event of events) {
      dispatchEvent(event, handlers);
    }
  }

  return stateToResult(state);
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
      Stream.tap((event) => Effect.sync(() => dispatchEvent(event, handlers))),
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
