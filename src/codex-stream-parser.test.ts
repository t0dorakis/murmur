import { describe, expect, test } from "bun:test";
import { parseCodexStream, runCodexParseStream } from "./codex-stream-parser.ts";
import type { ToolCall } from "./types.ts";

// Helpers to build Codex NDJSON lines
const threadStarted = JSON.stringify({
  type: "thread.started",
  thread_id: "test-thread-123",
});

const turnStarted = JSON.stringify({ type: "turn.started" });

const turnCompleted = () =>
  JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 1000, cached_input_tokens: 500, output_tokens: 200 },
  });

const itemStarted = (item: Record<string, unknown>) =>
  JSON.stringify({ type: "item.started", item });

const itemCompleted = (item: Record<string, unknown>) =>
  JSON.stringify({ type: "item.completed", item });

describe("parseCodexStream", () => {
  test("parses agent_message item", () => {
    const ndjson = [
      threadStarted,
      turnStarted,
      itemCompleted({
        id: "msg_1",
        type: "agent_message",
        text: "HEARTBEAT_OK",
      }),
      turnCompleted(),
    ].join("\n");

    const parsed = parseCodexStream(ndjson);
    expect(parsed.resultText).toBe("HEARTBEAT_OK");
    expect(parsed.turns).toHaveLength(1);
    expect(parsed.turns[0]).toEqual({
      role: "assistant",
      text: "HEARTBEAT_OK",
    });
  });

  test("fires onText callback for agent_message", () => {
    const texts: string[] = [];
    const ndjson = [
      threadStarted,
      itemCompleted({ id: "msg_1", type: "agent_message", text: "Hello" }),
      itemCompleted({ id: "msg_2", type: "agent_message", text: "World" }),
    ].join("\n");

    parseCodexStream(ndjson, { onText: (t) => texts.push(t) });
    expect(texts).toEqual(["Hello", "World"]);
  });

  test("parses command_execution item", () => {
    const ndjson = [
      threadStarted,
      turnStarted,
      itemCompleted({
        id: "cmd_1",
        type: "command_execution",
        command: "bash -lc git status",
        aggregated_output: "On branch main\nnothing to commit",
        exit_code: 0,
        status: "completed",
      }),
      turnCompleted(),
    ].join("\n");

    const parsed = parseCodexStream(ndjson);
    expect(parsed.turns).toHaveLength(1);
    const turn = parsed.turns[0]!;
    expect(turn.role).toBe("assistant");
    if (turn.role === "assistant") {
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls![0]!.name).toBe("command");
      expect(turn.toolCalls![0]!.input).toEqual({ command: "bash -lc git status" });
      expect(turn.toolCalls![0]!.output).toBe("On branch main\nnothing to commit");
    }
  });

  test("fires onToolCall callback for command_execution", () => {
    const toolCalls: ToolCall[] = [];
    const ndjson = [
      threadStarted,
      itemCompleted({
        id: "cmd_1",
        type: "command_execution",
        command: "bash -lc ls",
        aggregated_output: "file1\nfile2",
        exit_code: 0,
        status: "completed",
      }),
    ].join("\n");

    parseCodexStream(ndjson, { onToolCall: (tc) => toolCalls.push(tc) });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe("command");
    expect(toolCalls[0]!.output).toBe("file1\nfile2");
  });

  test("parses mcp_tool_call item", () => {
    const ndjson = [
      threadStarted,
      itemCompleted({
        id: "mcp_1",
        type: "mcp_tool_call",
        server: "my-server",
        tool: "search_docs",
        arguments: { query: "effect stream" },
        result: {
          content: [{ type: "text", text: "Found 3 results" }],
        },
        status: "completed",
      }),
    ].join("\n");

    const parsed = parseCodexStream(ndjson);
    expect(parsed.turns).toHaveLength(1);
    const turn = parsed.turns[0]!;
    if (turn.role === "assistant") {
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls![0]!.name).toBe("search_docs");
      expect(turn.toolCalls![0]!.input).toEqual({ query: "effect stream" });
      expect(turn.toolCalls![0]!.output).toBe("Found 3 results");
    }
  });

  test("parses mcp_tool_call with error", () => {
    const ndjson = [
      threadStarted,
      itemCompleted({
        id: "mcp_2",
        type: "mcp_tool_call",
        server: "my-server",
        tool: "broken_tool",
        arguments: {},
        error: { message: "Connection refused" },
        status: "failed",
      }),
    ].join("\n");

    const parsed = parseCodexStream(ndjson);
    const turn = parsed.turns[0]!;
    if (turn.role === "assistant") {
      expect(turn.toolCalls![0]!.output).toBe("Error: Connection refused");
    }
  });

  test("parses file_change item", () => {
    const changes = [
      { path: "src/main.ts", kind: "update" },
      { path: "src/new.ts", kind: "add" },
    ];
    const ndjson = [
      threadStarted,
      itemCompleted({
        id: "fc_1",
        type: "file_change",
        changes,
        status: "completed",
      }),
    ].join("\n");

    const parsed = parseCodexStream(ndjson);
    expect(parsed.turns).toHaveLength(1);
    const turn = parsed.turns[0]!;
    if (turn.role === "assistant") {
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls![0]!.name).toBe("file_change");
      expect(turn.toolCalls![0]!.input).toEqual({ changes });
    }
  });

  test("tracks duration from item.started to item.completed", () => {
    const toolCalls: ToolCall[] = [];
    const ndjson = [
      threadStarted,
      itemStarted({
        id: "cmd_1",
        type: "command_execution",
        command: "bash -lc sleep 1",
        aggregated_output: "",
        status: "in_progress",
      }),
      itemCompleted({
        id: "cmd_1",
        type: "command_execution",
        command: "bash -lc sleep 1",
        aggregated_output: "done",
        exit_code: 0,
        status: "completed",
      }),
    ].join("\n");

    parseCodexStream(ndjson, { onToolCall: (tc) => toolCalls.push(tc) });
    expect(toolCalls).toHaveLength(1);
    // Duration should be defined (will be very small in tests)
    expect(toolCalls[0]!.durationMs).toBeDefined();
    expect(typeof toolCalls[0]!.durationMs).toBe("number");
  });

  test("handles mixed events (messages + tools)", () => {
    const texts: string[] = [];
    const toolCalls: ToolCall[] = [];
    const ndjson = [
      threadStarted,
      turnStarted,
      itemCompleted({ id: "msg_1", type: "agent_message", text: "Let me check." }),
      itemStarted({
        id: "cmd_1",
        type: "command_execution",
        command: "bash -lc git status",
        aggregated_output: "",
        status: "in_progress",
      }),
      itemCompleted({
        id: "cmd_1",
        type: "command_execution",
        command: "bash -lc git status",
        aggregated_output: "clean",
        exit_code: 0,
        status: "completed",
      }),
      itemCompleted({ id: "msg_2", type: "agent_message", text: "HEARTBEAT_OK" }),
      turnCompleted(),
    ].join("\n");

    const parsed = parseCodexStream(ndjson, {
      onText: (t) => texts.push(t),
      onToolCall: (tc) => toolCalls.push(tc),
    });

    expect(texts).toEqual(["Let me check.", "HEARTBEAT_OK"]);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe("command");
    expect(parsed.resultText).toBe("HEARTBEAT_OK");
    expect(parsed.turns).toHaveLength(3); // 2 messages + 1 tool call
  });

  test("handles malformed lines gracefully", () => {
    const ndjson = [
      threadStarted,
      "not valid json {{{",
      itemCompleted({ id: "msg_1", type: "agent_message", text: "HEARTBEAT_OK" }),
      "",
      turnCompleted(),
    ].join("\n");

    const parsed = parseCodexStream(ndjson);
    expect(parsed.resultText).toBe("HEARTBEAT_OK");
    expect(parsed.turns).toHaveLength(1);
  });

  test("handles empty agent_message text", () => {
    const ndjson = [
      threadStarted,
      itemCompleted({ id: "msg_1", type: "agent_message", text: "" }),
    ].join("\n");

    const parsed = parseCodexStream(ndjson);
    expect(parsed.resultText).toBe("");
    expect(parsed.turns).toHaveLength(0); // empty text is skipped
  });

  test("uses last agent_message as resultText", () => {
    const ndjson = [
      threadStarted,
      itemCompleted({ id: "msg_1", type: "agent_message", text: "First thought" }),
      itemCompleted({ id: "msg_2", type: "agent_message", text: "HEARTBEAT_OK" }),
    ].join("\n");

    const parsed = parseCodexStream(ndjson);
    expect(parsed.resultText).toBe("HEARTBEAT_OK");
  });

  test("skips unknown event types gracefully", () => {
    const ndjson = [
      threadStarted,
      JSON.stringify({ type: "unknown.event", data: "foo" }),
      itemCompleted({ id: "msg_1", type: "agent_message", text: "ok" }),
    ].join("\n");

    const parsed = parseCodexStream(ndjson);
    expect(parsed.resultText).toBe("ok");
  });

  test("skips unknown item types in item.completed", () => {
    const ndjson = [
      threadStarted,
      itemCompleted({ id: "r_1", type: "reasoning", text: "thinking..." }),
      itemCompleted({ id: "msg_1", type: "agent_message", text: "done" }),
    ].join("\n");

    const parsed = parseCodexStream(ndjson);
    // reasoning item should be skipped, only message turn
    expect(parsed.turns).toHaveLength(1);
    expect(parsed.resultText).toBe("done");
  });

  test("skips turn.failed events without crashing", () => {
    const ndjson = [
      threadStarted,
      turnStarted,
      itemCompleted({ id: "msg_1", type: "agent_message", text: "partial" }),
      JSON.stringify({ type: "turn.failed", error: { message: "Rate limit exceeded" } }),
      itemCompleted({ id: "msg_2", type: "agent_message", text: "recovered" }),
    ].join("\n");

    const parsed = parseCodexStream(ndjson);
    expect(parsed.resultText).toBe("recovered");
    expect(parsed.turns).toHaveLength(2);
  });

  test("skips error events without crashing", () => {
    const ndjson = [
      threadStarted,
      JSON.stringify({ type: "error", message: "Internal server error" }),
      itemCompleted({ id: "msg_1", type: "agent_message", text: "ok" }),
    ].join("\n");

    const parsed = parseCodexStream(ndjson);
    expect(parsed.resultText).toBe("ok");
    expect(parsed.turns).toHaveLength(1);
  });
});

describe("runCodexParseStream", () => {
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
      threadStarted,
      turnStarted,
      itemCompleted({ id: "msg_1", type: "agent_message", text: "HEARTBEAT_OK" }),
      turnCompleted(),
    ].join("\n");

    const result = await runCodexParseStream(toReadableStream(ndjson));
    expect(result.resultText).toBe("HEARTBEAT_OK");
    expect(result.turns).toHaveLength(1);
  });

  test("calls handlers for tool calls", async () => {
    const toolCalls: ToolCall[] = [];
    const ndjson = [
      threadStarted,
      itemCompleted({
        id: "cmd_1",
        type: "command_execution",
        command: "bash -lc ls",
        aggregated_output: "file1\nfile2",
        exit_code: 0,
        status: "completed",
      }),
    ].join("\n");

    const result = await runCodexParseStream(toReadableStream(ndjson), {
      onToolCall: (tc) => toolCalls.push(tc),
    });

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe("command");
    expect(result.turns).toHaveLength(1);
  });

  test("calls handlers for text", async () => {
    const texts: string[] = [];
    const ndjson = [
      threadStarted,
      itemCompleted({ id: "msg_1", type: "agent_message", text: "Hello" }),
      itemCompleted({ id: "msg_2", type: "agent_message", text: "World" }),
    ].join("\n");

    await runCodexParseStream(toReadableStream(ndjson), {
      onText: (t) => texts.push(t),
    });

    expect(texts).toEqual(["Hello", "World"]);
  });

  test("handles malformed lines in stream", async () => {
    const ndjson = [
      threadStarted,
      "not valid json {{{",
      itemCompleted({ id: "msg_1", type: "agent_message", text: "ok" }),
    ].join("\n");

    const result = await runCodexParseStream(toReadableStream(ndjson));
    expect(result.resultText).toBe("ok");
    expect(result.turns).toHaveLength(1);
  });

  test("handles empty stream", async () => {
    const result = await runCodexParseStream(toReadableStream(""));
    expect(result.resultText).toBe("");
    expect(result.turns).toHaveLength(0);
  });

  test("handles chunked input", async () => {
    const line1 = itemStarted({
      id: "cmd_1",
      type: "command_execution",
      command: "bash -lc ls",
      aggregated_output: "",
      status: "in_progress",
    });
    const line2 = itemCompleted({
      id: "cmd_1",
      type: "command_execution",
      command: "bash -lc ls",
      aggregated_output: "contents",
      exit_code: 0,
      status: "completed",
    });
    const line3 = itemCompleted({ id: "msg_1", type: "agent_message", text: "ok" });
    const ndjson = [line1, line2, line3].join("\n");

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
    const result = await runCodexParseStream(stream, {
      onToolCall: (tc) => toolCalls.push(tc),
    });

    expect(toolCalls).toHaveLength(1);
    expect(result.resultText).toBe("ok");
  });
});
