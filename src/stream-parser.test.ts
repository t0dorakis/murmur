import { describe, expect, test } from "bun:test";
import { parseStreamJson, createStreamProcessor } from "./stream-parser.ts";
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

const userToolResultEvent = (toolUseId: string, content: string) =>
  JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content }] },
  });

const resultEvent = (result: string, costUsd?: number, numTurns?: number) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    result,
    cost_usd: costUsd,
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

    const toolTurn = parsed.turns[0];
    expect(toolTurn).toMatchObject({ role: "assistant" });
    if (toolTurn!.role === "assistant") {
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

  test("fires onAssistantText callback", () => {
    const texts: string[] = [];
    const ndjson = [
      initEvent,
      assistantTextEvent("Hello world"),
      assistantTextEvent("Second message"),
      resultEvent("done"),
    ].join("\n");

    parseStreamJson(ndjson, {
      onAssistantText: (t) => texts.push(t),
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

describe("createStreamProcessor", () => {
  test("processes chunks incrementally", () => {
    const toolCalls: ToolCall[] = [];
    const processor = createStreamProcessor({
      onToolCall: (tc) => toolCalls.push(tc),
    });

    // Feed data in chunks
    const line1 = assistantToolCallEvent("Bash", { command: "ls" }, "tool_10");
    const line2 = userToolResultEvent("tool_10", "file1\nfile2");
    const line3 = resultEvent("done");

    processor.write(line1 + "\n");
    processor.write(line2 + "\n");
    processor.write(line3 + "\n");
    processor.flush();

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe("Bash");

    const result = processor.result();
    expect(result.resultText).toBe("done");
    expect(result.turns).toHaveLength(2); // assistant + result
  });

  test("handles partial lines across chunks", () => {
    const processor = createStreamProcessor();
    const line = assistantTextEvent("hello");

    // Split the line across two chunks
    const mid = Math.floor(line.length / 2);
    processor.write(line.slice(0, mid));
    processor.write(line.slice(mid) + "\n");

    const result = processor.result();
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({ role: "assistant", text: "hello" });
  });

  test("flush processes remaining buffer", () => {
    const processor = createStreamProcessor();
    const line = resultEvent("final");

    // No trailing newline
    processor.write(line);
    processor.flush();

    const result = processor.result();
    expect(result.resultText).toBe("final");
  });
});
