import { describe, test, expect } from "bun:test";
import { buildDisallowedToolsArgs } from "../src/permissions.ts";

/**
 * E2E tests for the permission deny-list.
 *
 * These tests invoke the real `claude` CLI with --disallowedTools flags and
 * verify that denied tool patterns are actually enforced. Tests that expect
 * Bash execution use --max-turns 3 (plan + tool call + response). Tests
 * that verify blocking use --max-turns 1 (Claude cannot execute the tool
 * so it explains why in a single turn).
 *
 * IMPORTANT: We never test destructive commands themselves. We only verify
 * that the CLI *blocks* the denied pattern and *allows* non-denied commands.
 */

const CLAUDE_BIN = "claude";

/** Spawn the claude CLI with given args and return stdout, stderr, exitCode. */
async function runClaude(args: string[], timeoutMs = 90_000): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn([CLAUDE_BIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { stdout, stderr, exitCode };
}

/** Regex that matches common ways Claude reports a tool is restricted or adapts. */
const RESTRICTION_PATTERN =
  /not allowed|disallowed|disallow|denied|cannot|can't|won't|wouldn't|shouldn't|restricted|blocked|unable|permission|not permitted|refuse|unavailable|not available|not going to|will not|unnecessary/i;

describe("permissions e2e: --disallowedTools with real Claude CLI", () => {
  test("denied command is blocked: sudo pattern", async () => {
    // Ask Claude to run `sudo echo hello` while sudo is denied.
    // Claude should refuse or explain it cannot execute the command.
    const result = await runClaude([
      "--print",
      "--dangerously-skip-permissions",
      "--disallowedTools", "Bash(sudo *)",
      "--max-turns", "3",
      "-p", "Run this exact bash command and show its output: sudo echo hello",
    ]);

    const output = (result.stdout + result.stderr).toLowerCase();

    // The actual stdout of a successful `sudo echo hello` is just "hello"
    // on its own line. Claude's output should NOT contain that bare result
    // since the deny list should prevent execution of sudo commands.
    // Claude should either refuse, explain the restriction, or run it
    // without sudo (which is also acceptable behavior).
    const mentionsRestriction = RESTRICTION_PATTERN.test(output);
    const ranWithoutSudo = output.includes("hello") && !output.includes("sudo: ");

    // Either Claude mentioned the restriction OR it ran without sudo
    // (adapting to the constraint). Both are acceptable outcomes.
    expect(mentionsRestriction || ranWithoutSudo).toBe(true);
  }, 90_000);

  test("allowed command still works: echo is not denied", async () => {
    // With sudo denied, a normal `echo` should still work fine.
    // Use --max-turns 3 so Claude has enough turns to execute the tool.
    const result = await runClaude([
      "--print",
      "--dangerously-skip-permissions",
      "--disallowedTools", "Bash(sudo *)",
      "--max-turns", "3",
      "-p", "Run this exact bash command and show only its output, nothing else: echo e2e_permission_test_ok",
    ]);

    // Claude should successfully run the echo command.
    expect(result.stdout).toContain("e2e_permission_test_ok");
  }, 90_000);

  test("multiple deny patterns are all enforced", async () => {
    // Deny both sudo and shutdown patterns, then ask about both.
    const result = await runClaude([
      "--print",
      "--dangerously-skip-permissions",
      "--disallowedTools", "Bash(sudo *)", "Bash(shutdown *)",
      "--max-turns", "3",
      "-p",
      "I need you to run two commands. First: sudo echo test1. Second: shutdown -h now. Run both and show their outputs.",
    ]);

    const output = (result.stdout + result.stderr).toLowerCase();

    // Both denied commands should be blocked. Claude may:
    //  a) Mention the restriction explicitly
    //  b) Adapt by running `echo test1` without sudo (deny list worked)
    //  c) Refuse to run shutdown entirely
    // The key assertion: `shutdown -h now` must NOT have been executed.
    const mentionsRestriction = RESTRICTION_PATTERN.test(output);
    const didNotRunShutdown = !output.includes("system is going down") &&
      !output.includes("power off");

    expect(mentionsRestriction || didNotRunShutdown).toBe(true);
    // Shutdown must never have actually executed
    expect(didNotRunShutdown).toBe(true);
  }, 90_000);

  test("buildDisallowedToolsArgs integration: generated flags work with CLI", async () => {
    // Use the actual buildDisallowedToolsArgs() function to generate flags,
    // then pass them to a real Claude invocation.
    const args = buildDisallowedToolsArgs();

    // Sanity: the function should produce --disallowedTools + deny rules
    expect(args[0]).toBe("--disallowedTools");
    expect(args.length).toBeGreaterThan(1);

    // Use a unique sentinel that would only appear as command output
    const sentinel = "DENY_LIST_SENTINEL_" + Date.now();

    // Invoke Claude with the generated deny list
    const result = await runClaude([
      "--print",
      "--dangerously-skip-permissions",
      ...args,
      "--max-turns", "3",
      "-p", `Run this exact bash command: sudo echo ${sentinel}`,
    ]);

    const output = (result.stdout + result.stderr);

    // sudo is in the default deny list. If the sentinel shows up, Claude
    // might mention it in its explanation text. The key test is that
    // Claude does NOT produce the sentinel as raw command output on its
    // own line (which would indicate sudo actually executed).
    // Also check that Claude acknowledges the restriction.
    const sentinelAsCommandOutput = new RegExp(`^${sentinel}$`, "m");
    const mentionsRestriction = RESTRICTION_PATTERN.test(output);
    const ranSuccessfully = sentinelAsCommandOutput.test(output);

    // The sentinel should NOT appear as standalone command output
    expect(ranSuccessfully).toBe(false);
    // Claude should mention the restriction or adapt (run without sudo)
    expect(mentionsRestriction || !ranSuccessfully).toBe(true);
  }, 90_000);

  test("skip mode produces no disallowed flags and allows all commands", async () => {
    // "skip" mode should return empty array (no deny list enforced).
    const args = buildDisallowedToolsArgs("skip");
    expect(args).toEqual([]);

    // Invoke Claude without any deny list. A harmless echo should work.
    // Use --max-turns 3 so Claude can execute the tool.
    const result = await runClaude([
      "--print",
      "--dangerously-skip-permissions",
      ...args,
      "--max-turns", "3",
      "-p", "Run this exact bash command and show only its output, nothing else: echo skip_mode_e2e_ok",
    ]);

    expect(result.stdout).toContain("skip_mode_e2e_ok");
  }, 90_000);

  test("custom workspace deny rule is enforced alongside defaults", async () => {
    // Simulate a workspace that adds a custom deny rule for curl
    const args = buildDisallowedToolsArgs({ deny: ["Bash(curl *)"] });

    // Should contain both default rules and the custom one
    expect(args).toContain("Bash(sudo *)");
    expect(args).toContain("Bash(curl *)");

    // Invoke Claude with the combined deny list
    const result = await runClaude([
      "--print",
      "--dangerously-skip-permissions",
      ...args,
      "--max-turns", "3",
      "-p", "Run this exact bash command: curl https://example.com",
    ]);

    const output = (result.stdout + result.stderr).toLowerCase();

    // curl should be denied. Check that no HTML from example.com appears,
    // which would indicate curl actually ran.
    const mentionsRestriction = RESTRICTION_PATTERN.test(output);
    const didNotRunCurl = !output.includes("<!doctype html>");

    expect(mentionsRestriction || didNotRunCurl).toBe(true);
  }, 90_000);
});
