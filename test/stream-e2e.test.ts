import { describe, test, expect } from "bun:test";
import { parseStreamJson, createStreamProcessor } from "../src/stream-parser.ts";
import type { ToolCall } from "../src/types.ts";

/**
 * E2E tests for stream-json parsing against the real Claude CLI.
 *
 * These tests spawn `claude --output-format stream-json` and feed the
 * real NDJSON output through parseStreamJson() and createStreamProcessor()
 * to verify the parser handles actual CLI output correctly.
 *
 * Requirements:
 *   - `claude` CLI installed and authenticated
 *   - Network access (calls the Claude API)
 */

/** Spawn the Claude CLI with stream-json output and return raw stdout. */
async function spawnClaude(prompt: string, maxTurns = 1): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(
    [
      "claude",
      "--print",
      "--verbose",
      "--dangerously-skip-permissions",
      "--output-format",
      "stream-json",
      "--max-turns",
      String(maxTurns),
      "-p",
      prompt,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 90_000,
    },
  );

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    console.log(`[claude] exit=${exitCode}`);
    console.log(`[claude] stderr: ${stderr}`);
    console.log(`[claude] stdout (first 500): ${stdout.slice(0, 500)}`);
  }

  return { stdout, exitCode };
}

describe("stream-json e2e (real Claude CLI)", () => {
  test("parse real stream-json output with result and cost", async () => {
    const { stdout, exitCode } = await spawnClaude(
      "What is 2+2? Just answer the number, nothing else.",
    );
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);

    const parsed = parseStreamJson(stdout);

    // Must have at least an assistant turn and a result turn
    expect(parsed.turns.length).toBeGreaterThanOrEqual(2);

    // Result text should contain "4"
    expect(parsed.resultText).toContain("4");

    // The result turn must exist and have the correct role
    const resultTurn = parsed.turns.find((t) => t.role === "result");
    expect(resultTurn).toBeDefined();
    expect(resultTurn!.role).toBe("result");

    // Cost must be a positive number (the critical bug fix: total_cost_usd, not cost_usd)
    expect(parsed.costUsd).toBeDefined();
    expect(typeof parsed.costUsd).toBe("number");
    expect(parsed.costUsd!).toBeGreaterThan(0);

    // numTurns should be reported
    expect(parsed.numTurns).toBeDefined();
    expect(typeof parsed.numTurns).toBe("number");
    expect(parsed.numTurns!).toBeGreaterThanOrEqual(1);
  }, 90_000);

  test("tool call capture with Bash tool", async () => {
    const { stdout, exitCode } = await spawnClaude(
      'Run the command: echo hello_from_test. Only use the Bash tool. Do not explain.',
      2,
    );
    expect(exitCode).toBe(0);

    const toolCalls: ToolCall[] = [];
    const parsed = parseStreamJson(stdout, {
      onToolCall: (tc) => toolCalls.push(tc),
    });

    // Should have captured at least one tool call
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);

    // Find the Bash tool call
    const bashCall = toolCalls.find((tc) => tc.name === "Bash");
    expect(bashCall).toBeDefined();
    expect(bashCall!.name).toBe("Bash");

    // The tool output should contain our marker string
    expect(bashCall!.output).toBeDefined();
    expect(bashCall!.output!).toContain("hello_from_test");

    // Verify the turns also contain the tool call
    const assistantWithTool = parsed.turns.find(
      (t) => t.role === "assistant" && t.toolCalls && t.toolCalls.length > 0,
    );
    expect(assistantWithTool).toBeDefined();
    if (assistantWithTool?.role === "assistant" && assistantWithTool.toolCalls) {
      const turnBashCall = assistantWithTool.toolCalls.find((tc) => tc.name === "Bash");
      expect(turnBashCall).toBeDefined();
      expect(turnBashCall!.output).toContain("hello_from_test");
    }
  }, 90_000);

  test("streaming processor matches batch parser", async () => {
    const { stdout, exitCode } = await spawnClaude(
      "What is 3+5? Just answer the number, nothing else.",
    );
    expect(exitCode).toBe(0);

    // Parse with batch parser
    const batchResult = parseStreamJson(stdout);

    // Parse with streaming processor (simulate chunked reading)
    const streamProcessor = createStreamProcessor();
    // Feed the output in chunks to simulate real streaming
    const chunkSize = 256;
    for (let i = 0; i < stdout.length; i += chunkSize) {
      streamProcessor.write(stdout.slice(i, i + chunkSize));
    }
    streamProcessor.flush();
    const streamResult = streamProcessor.result();

    // Both should produce the same result text
    expect(streamResult.resultText).toBe(batchResult.resultText);

    // Both should have the same number of turns
    expect(streamResult.turns.length).toBe(batchResult.turns.length);

    // Both should report the same cost
    expect(streamResult.costUsd).toBe(batchResult.costUsd);

    // Both should report the same numTurns
    expect(streamResult.numTurns).toBe(batchResult.numTurns);

    // Verify turns have the same roles in the same order
    for (let i = 0; i < batchResult.turns.length; i++) {
      expect(streamResult.turns[i]!.role).toBe(batchResult.turns[i]!.role);
      if (batchResult.turns[i]!.role === "result") {
        const batchTurn = batchResult.turns[i] as { role: "result"; text: string; costUsd?: number };
        const streamTurn = streamResult.turns[i] as { role: "result"; text: string; costUsd?: number };
        expect(streamTurn.text).toBe(batchTurn.text);
        expect(streamTurn.costUsd).toBe(batchTurn.costUsd);
      }
    }
  }, 90_000);

  test("cost field total_cost_usd is a positive number", async () => {
    // This specifically validates the fix: the parser reads `total_cost_usd`
    // (not the old `cost_usd`) from the result event.
    const { stdout, exitCode } = await spawnClaude(
      "Say OK.",
    );
    expect(exitCode).toBe(0);

    const parsed = parseStreamJson(stdout);

    // Find the result turn directly
    const resultTurn = parsed.turns.find((t) => t.role === "result");
    expect(resultTurn).toBeDefined();

    if (resultTurn?.role === "result") {
      // costUsd on the turn must be populated and positive
      expect(resultTurn.costUsd).toBeDefined();
      expect(typeof resultTurn.costUsd).toBe("number");
      expect(resultTurn.costUsd!).toBeGreaterThan(0);
    }

    // Top-level costUsd must also match
    expect(parsed.costUsd).toBeDefined();
    expect(parsed.costUsd!).toBeGreaterThan(0);

    // Verify the raw NDJSON contains total_cost_usd (not cost_usd)
    const lines = stdout.split("\n").filter((l) => l.trim());
    const resultLine = lines.find((l) => {
      try {
        const obj = JSON.parse(l);
        return obj.type === "result";
      } catch {
        return false;
      }
    });
    expect(resultLine).toBeDefined();
    const resultObj = JSON.parse(resultLine!);
    expect(resultObj.total_cost_usd).toBeDefined();
    expect(typeof resultObj.total_cost_usd).toBe("number");
    expect(resultObj.total_cost_usd).toBeGreaterThan(0);
  }, 90_000);

  test("extractToolOutput handles string content from real CLI", async () => {
    const { stdout, exitCode } = await spawnClaude(
      'Use Bash to run: echo test_output_42. Only use the tool, do not explain.',
      2,
    );
    expect(exitCode).toBe(0);

    const toolCalls: ToolCall[] = [];
    parseStreamJson(stdout, {
      onToolCall: (tc) => toolCalls.push(tc),
    });

    // At least one tool call should have been captured
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);

    // The Bash tool output should be a string containing our marker
    const bashCall = toolCalls.find((tc) => tc.name === "Bash");
    expect(bashCall).toBeDefined();
    expect(typeof bashCall!.output).toBe("string");
    expect(bashCall!.output!).toContain("test_output_42");
  }, 90_000);
});
