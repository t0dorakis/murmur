/**
 * Parses Claude Code CLI `--output-format stream-json` NDJSON output.
 *
 * The stream-json format emits newline-delimited JSON. Each line is one of:
 *   { type: "system", subtype: "init", session_id, tools, ... }
 *   { type: "assistant", message: { content: [{ type: "text", text }, { type: "tool_use", name, input, id }] } }
 *   { type: "user", message: { content: [{ type: "tool_result", tool_use_id, content }] } }
 *   { type: "result", subtype: "success"|"error", result, cost_usd, duration_ms, num_turns, ... }
 */

import type { ConversationTurn, ToolCall } from "./types.ts";

/** Raw content block from Claude's stream-json messages. */
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content?: string };

/** Raw message envelope from stream-json. */
type StreamMessage =
  | { type: "system"; subtype: "init"; session_id: string; tools?: unknown[] }
  | { type: "assistant"; message: { content: ContentBlock[] } }
  | { type: "user"; message: { content: ContentBlock[] } }
  | { type: "result"; subtype: string; result?: string; cost_usd?: number; duration_ms?: number; num_turns?: number };

export type StreamParseResult = {
  /** The final text result from the agent. */
  resultText: string;
  /** Parsed conversation turns for verbose display. */
  turns: ConversationTurn[];
  /** Cost in USD, if reported. */
  costUsd?: number;
  /** Number of agent turns, if reported. */
  numTurns?: number;
};

/**
 * Callback invoked as each tool call is completed (tool_use + tool_result matched).
 */
export type OnToolCall = (toolCall: ToolCall) => void;

/**
 * Callback invoked for each assistant text chunk.
 */
export type OnAssistantText = (text: string) => void;

/**
 * Parse a complete NDJSON stream from Claude Code CLI stream-json output.
 */
export function parseStreamJson(
  ndjson: string,
  callbacks?: { onToolCall?: OnToolCall; onAssistantText?: OnAssistantText },
): StreamParseResult {
  const lines = ndjson.split("\n").filter((l) => l.trim());
  const turns: ConversationTurn[] = [];
  let resultText = "";
  let costUsd: number | undefined;
  let numTurns: number | undefined;

  // Track pending tool_use blocks to match with tool_results
  const pendingTools = new Map<string, { name: string; input: Record<string, unknown>; startMs: number }>();

  for (const line of lines) {
    let msg: StreamMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      // Skip malformed lines
      continue;
    }

    switch (msg.type) {
      case "assistant": {
        const textBlocks: string[] = [];
        const toolCalls: ToolCall[] = [];

        for (const block of msg.message?.content ?? []) {
          if (block.type === "text" && block.text) {
            textBlocks.push(block.text);
            callbacks?.onAssistantText?.(block.text);
          } else if (block.type === "tool_use") {
            pendingTools.set(block.id, {
              name: block.name,
              input: block.input,
              startMs: Date.now(),
            });
            toolCalls.push({ name: block.name, input: block.input });
          }
        }

        const turn: ConversationTurn = { role: "assistant" };
        if (textBlocks.length > 0) turn.text = textBlocks.join("");
        if (toolCalls.length > 0) turn.toolCalls = toolCalls;
        turns.push(turn);
        break;
      }

      case "user": {
        for (const block of msg.message?.content ?? []) {
          if (block.type === "tool_result" && block.tool_use_id) {
            const pending = pendingTools.get(block.tool_use_id);
            if (pending) {
              const toolCall: ToolCall = {
                name: pending.name,
                input: pending.input,
                output: typeof block.content === "string" ? block.content : undefined,
                durationMs: Date.now() - pending.startMs,
              };
              callbacks?.onToolCall?.(toolCall);
              pendingTools.delete(block.tool_use_id);

              // Update the most recent assistant turn's matching tool call with output
              for (let i = turns.length - 1; i >= 0; i--) {
                const t = turns[i]!;
                if (t.role === "assistant" && t.toolCalls) {
                  const match = t.toolCalls.find(
                    (tc) => tc.name === pending.name && !tc.output,
                  );
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
        resultText = msg.result ?? "";
        costUsd = msg.cost_usd;
        numTurns = msg.num_turns;
        turns.push({
          role: "result",
          text: resultText,
          costUsd,
          durationMs: msg.duration_ms,
          numTurns,
        });
        break;
      }

      // "system" init messages are informational; skip
    }
  }

  return { resultText, turns, costUsd, numTurns };
}

/**
 * Create a line-buffered NDJSON stream processor that processes messages
 * as they arrive (for real-time verbose output during streaming).
 */
export function createStreamProcessor(callbacks?: {
  onToolCall?: OnToolCall;
  onAssistantText?: OnAssistantText;
}) {
  let buffer = "";
  const turns: ConversationTurn[] = [];
  let resultText = "";
  let costUsd: number | undefined;
  let numTurns: number | undefined;
  const pendingTools = new Map<string, { name: string; input: Record<string, unknown>; startMs: number }>();

  function processLine(line: string) {
    let msg: StreamMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    switch (msg.type) {
      case "assistant": {
        const textBlocks: string[] = [];
        const toolCalls: ToolCall[] = [];

        for (const block of msg.message?.content ?? []) {
          if (block.type === "text" && block.text) {
            textBlocks.push(block.text);
            callbacks?.onAssistantText?.(block.text);
          } else if (block.type === "tool_use") {
            pendingTools.set(block.id, {
              name: block.name,
              input: block.input,
              startMs: Date.now(),
            });
            toolCalls.push({ name: block.name, input: block.input });
          }
        }

        const turn: ConversationTurn = { role: "assistant" };
        if (textBlocks.length > 0) turn.text = textBlocks.join("");
        if (toolCalls.length > 0) turn.toolCalls = toolCalls;
        turns.push(turn);
        break;
      }

      case "user": {
        for (const block of msg.message?.content ?? []) {
          if (block.type === "tool_result" && block.tool_use_id) {
            const pending = pendingTools.get(block.tool_use_id);
            if (pending) {
              const toolCall: ToolCall = {
                name: pending.name,
                input: pending.input,
                output: typeof block.content === "string" ? block.content : undefined,
                durationMs: Date.now() - pending.startMs,
              };
              callbacks?.onToolCall?.(toolCall);
              pendingTools.delete(block.tool_use_id);

              for (let i = turns.length - 1; i >= 0; i--) {
                const t = turns[i]!;
                if (t.role === "assistant" && t.toolCalls) {
                  const match = t.toolCalls.find(
                    (tc) => tc.name === pending.name && !tc.output,
                  );
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
        resultText = msg.result ?? "";
        costUsd = msg.cost_usd;
        numTurns = msg.num_turns;
        turns.push({
          role: "result",
          text: resultText,
          costUsd,
          durationMs: msg.duration_ms,
          numTurns,
        });
        break;
      }
    }
  }

  return {
    /** Feed a chunk of data from the stream. */
    write(chunk: string) {
      buffer += chunk;
      const lines = buffer.split("\n");
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) processLine(line);
      }
    },

    /** Flush any remaining data in the buffer. */
    flush() {
      if (buffer.trim()) {
        processLine(buffer);
        buffer = "";
      }
    },

    /** Get the final parse result. */
    result(): StreamParseResult {
      return { resultText, turns, costUsd, numTurns };
    },
  };
}
