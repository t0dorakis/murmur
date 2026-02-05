import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { parseStreamJson, runParseStream, runParseStreamEffect } from "./stream-parser.ts";
import type { ToolCall } from "./types.ts";

// Helpers to build stream-json NDJSON lines
const initEvent = JSON.stringify({
  type: "system",
  subtype: "init",
  session_id: "test-session",
  tools: ["Bash", "Read", "Write"],
});

const assistantTextEvent = (text: string) =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  });

const assistantToolCallEvent = (name: string, input: Record<string, unknown>, id: string) =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  });

const assistantMixedEvent = (
  text: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolId: string,
) =>
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text },
        { type: "tool_use", id: toolId, name: toolName, input: toolInput },
      ],
    },
  });

const userToolResultEvent = (toolUseId: string, content: string | Array<{ type: string; text?: string }>) =>
  JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content }] },
  });

const resultEvent = (result: string, costUsd?: number, numTurns?: number) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    result,
    total_cost_usd: costUsd,
    duration_ms: 1234,
    num_turns: numTurns,
  });

describe("parseStreamJson", () => {
  test("parses simple text-only conversation", () => {
    const ndjson = [
      initEvent,
      assistantTextEvent("HEARTBEAT_OK"),
      resultEvent("HEARTBEAT_OK"),
    ].join("\n");

    const parsed = parseStreamJson(ndjson);
    expect(parsed.resultText).toBe("HEARTBEAT_OK");
    expect(parsed.turns).toHaveLength(2); // assistant + result
    expect(parsed.turns[0]).toEqual({ role: "assistant", text: "HEARTBEAT_OK" });
    expect(parsed.turns[1]).toMatchObject({ role: "result", text: "HEARTBEAT_OK" });
  });

  test("parses conversation with tool calls", () => {
    const ndjson = [
      initEvent,
      assistantToolCallEvent("Bash", { command: "git status" }, "tool_01"),
      userToolResultEvent("tool_01", "On branch main\nnothing to commit"),
      assistantTextEvent("HEARTBEAT_OK"),
      resultEvent("HEARTBEAT_OK", 0.05, 2),
    ].join("\n");

    const parsed = parseStreamJson(ndjson);
    expect(parsed.resultText).toBe("HEARTBEAT_OK");
    expect(parsed.costUsd).toBe(0.05);
    expect(parsed.numTurns).toBe(2);
    expect(parsed.turns).toHaveLength(3); // tool-call assistant + text assistant + result

    const toolTurn = parsed.turns[0]!;
    expect(toolTurn).toMatchObject({ role: "assistant" });
    if (toolTurn.role === "assistant") {
      expect(toolTurn.toolCalls).toHaveLength(1);
      expect(toolTurn.toolCalls![0]!.name).toBe("Bash");
      expect(toolTurn.toolCalls![0]!.input).toEqual({ command: "git status" });
      expect(toolTurn.toolCalls![0]!.output).toBe("On branch main\nnothing to commit");
    }
  });

  test("parses mixed text and tool call in single assistant message", () => {
    const ndjson = [
      initEvent,
      assistantMixedEvent(
        "Let me check the status.",
        "Bash",
        { command: "git status" },
        "tool_02",
      ),
      userToolResultEvent("tool_02", "clean"),
      resultEvent("HEARTBEAT_OK"),
    ].join("\n");

    const parsed = parseStreamJson(ndjson);
    const turn = parsed.turns[0]!;
    expect(turn.role).toBe("assistant");
    if (turn.role === "assistant") {
      expect(turn.text).toBe("Let me check the status.");
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls![0]!.name).toBe("Bash");
      expect(turn.toolCalls![0]!.output).toBe("clean");
    }
  });

  test("handles malformed lines gracefully", () => {
    const ndjson = [
      initEvent,
      "not valid json {{{",
      assistantTextEvent("HEARTBEAT_OK"),
      "",
      resultEvent("HEARTBEAT_OK"),
    ].join("\n");

    const parsed = parseStreamJson(ndjson);
    expect(parsed.resultText).toBe("HEARTBEAT_OK");
    expect(parsed.turns).toHaveLength(2);
  });

  test("fires onToolCall callback", () => {
    const toolCalls: ToolCall[] = [];
    const ndjson = [
      initEvent,
      assistantToolCallEvent("Read", { file_path: "/foo/bar.ts" }, "tool_03"),
      userToolResultEvent("tool_03", "file contents here"),
      resultEvent("ok"),
    ].join("\n");

    parseStreamJson(ndjson, {
      onToolCall: (tc) => toolCalls.push(tc),
    });

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe("Read");
    expect(toolCalls[0]!.output).toBe("file contents here");
  });

  test("handles array-format tool_result content", () => {
    const toolCalls: ToolCall[] = [];
    const ndjson = [
      initEvent,
      assistantToolCallEvent("Bash", { command: "echo hello" }, "tool_04"),
      userToolResultEvent("tool_04", [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ]),
      resultEvent("ok"),
    ].join("\n");

    const parsed = parseStreamJson(ndjson, {
      onToolCall: (tc) => toolCalls.push(tc),
    });

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.output).toBe("hello\nworld");

    // Also check it was propagated to the turn
    const toolTurn = parsed.turns[0]!;
    if (toolTurn.role === "assistant" && toolTurn.toolCalls) {
      expect(toolTurn.toolCalls[0]!.output).toBe("hello\nworld");
    }
  });

  test("fires onText callback", () => {
    const texts: string[] = [];
    const ndjson = [
      initEvent,
      assistantTextEvent("Hello world"),
      assistantTextEvent("Second message"),
      resultEvent("done"),
    ].join("\n");

    parseStreamJson(ndjson, {
      onText: (t) => texts.push(t),
    });

    expect(texts).toEqual(["Hello world", "Second message"]);
  });

  test("handles empty result", () => {
    const ndjson = [
      initEvent,
      resultEvent(""),
    ].join("\n");

    const parsed = parseStreamJson(ndjson);
    expect(parsed.resultText).toBe("");
    expect(parsed.turns).toHaveLength(1);
  });
});

describe("runParseStream", () => {
  function toReadableStream(text: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    });
  }

  test("processes stream and returns result", async () => {
    const ndjson = [
      initEvent,
      assistantTextEvent("HEARTBEAT_OK"),
      resultEvent("HEARTBEAT_OK", 0.05, 1),
    ].join("\n");

    const result = await runParseStream(toReadableStream(ndjson));
    expect(result.resultText).toBe("HEARTBEAT_OK");
    expect(result.costUsd).toBe(0.05);
    expect(result.numTurns).toBe(1);
    expect(result.turns).toHaveLength(2);
  });

  test("calls handlers for tool calls", async () => {
    const toolCalls: ToolCall[] = [];
    const ndjson = [
      initEvent,
      assistantToolCallEvent("Bash", { command: "ls" }, "tool_10"),
      userToolResultEvent("tool_10", "file1\nfile2"),
      resultEvent("done"),
    ].join("\n");

    const result = await runParseStream(toReadableStream(ndjson), {
      onToolCall: (tc) => toolCalls.push(tc),
    });

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe("Bash");
    expect(result.resultText).toBe("done");
    expect(result.turns).toHaveLength(2);
  });

  test("calls handlers for text", async () => {
    const texts: string[] = [];
    const ndjson = [
      initEvent,
      assistantTextEvent("Hello"),
      assistantTextEvent("World"),
      resultEvent("done"),
    ].join("\n");

    await runParseStream(toReadableStream(ndjson), {
      onText: (t) => texts.push(t),
    });

    expect(texts).toEqual(["Hello", "World"]);
  });

  test("handles chunked input", async () => {
    const line1 = assistantToolCallEvent("Read", { file_path: "/test" }, "tool_20");
    const line2 = userToolResultEvent("tool_20", "contents");
    const line3 = resultEvent("ok");
    const ndjson = [line1, line2, line3].join("\n");

    // Split into multiple chunks
    const encoder = new TextEncoder();
    const chunks = [ndjson.slice(0, 50), ndjson.slice(50, 100), ndjson.slice(100)];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const toolCalls: ToolCall[] = [];
    const result = await runParseStream(stream, {
      onToolCall: (tc) => toolCalls.push(tc),
    });

    expect(toolCalls).toHaveLength(1);
    expect(result.resultText).toBe("ok");
  });
});

describe("runParseStreamEffect", () => {
  function toReadableStream(text: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    });
  }

  test("returns Effect with result", async () => {
    const ndjson = [
      initEvent,
      assistantTextEvent("HEARTBEAT_OK"),
      resultEvent("HEARTBEAT_OK", 0.05, 1),
    ].join("\n");

    const result = await Effect.runPromise(
      runParseStreamEffect(toReadableStream(ndjson))
    );
    expect(result.resultText).toBe("HEARTBEAT_OK");
    expect(result.costUsd).toBe(0.05);
    expect(result.numTurns).toBe(1);
    expect(result.turns).toHaveLength(2);
  });

  test("calls handlers via Effect", async () => {
    const toolCalls: ToolCall[] = [];
    const ndjson = [
      initEvent,
      assistantToolCallEvent("Bash", { command: "ls" }, "tool_30"),
      userToolResultEvent("tool_30", "file1\nfile2"),
      resultEvent("done"),
    ].join("\n");

    const result = await Effect.runPromise(
      runParseStreamEffect(toReadableStream(ndjson), {
        onToolCall: (tc) => toolCalls.push(tc),
      })
    );

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe("Bash");
    expect(result.resultText).toBe("done");
  });
});
