import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { DEBUG_LOG_FILENAME } from "../src/debug.ts";

/**
 * E2E tests for `murmur beat` (verbose by default, --quiet to suppress).
 *
 * These tests exercise the actual compiled murmur binary, verifying that
 * default mode surfaces tool calls, conversation summaries, and cost
 * information -- and that quiet mode (--quiet) omits those details.
 *
 * Requirements:
 *   - Compiled murmur binary (run `bun run build` first)
 *   - `claude` CLI installed and authenticated
 *   - Network access (murmur spawns Claude under the hood)
 */

const REPO_DIR = join(import.meta.dir, "..");
const MURMUR_BIN = join(REPO_DIR, "murmur");

/** Isolated data directory so tests do not pollute ~/.murmur */
let testDataDir: string;
/** Temp workspace with a HEARTBEAT.md that triggers a tool call */
let testWorkspace: string;

/**
 * The heartbeat requires Claude to read a status file before it can respond.
 * This forces at least one tool call (Read or Bash) so we can verify
 * tool-call visibility in default (verbose) mode.
 */
const TEST_HEARTBEAT = `# Heartbeat

Check the file \`status.txt\` in this directory using the Bash tool (\`cat status.txt\`).
You MUST use the Bash tool to read the file -- do NOT guess the contents.

If the file contains "all clear", respond with exactly \`HEARTBEAT_OK\`.
Otherwise, respond with \`ATTENTION:\` followed by the file contents.
`;

/** The status file that the heartbeat checks -- content triggers HEARTBEAT_OK. */
const STATUS_FILE_CONTENT = "all clear\n";

/** Spawn the murmur binary with the shared --data-dir and --debug flags. */
async function murmur(...args: string[]) {
  const proc = Bun.spawn([MURMUR_BIN, "--data-dir", testDataDir, "--debug", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    console.log(`[murmur ${args.join(" ")}] exit=${exitCode}`);
    console.log(`[murmur ${args.join(" ")}] stdout: ${stdout}`);
    console.log(`[murmur ${args.join(" ")}] stderr: ${stderr}`);
    dumpDebugLog();
  }

  return { exitCode, stdout, stderr };
}

function dumpDebugLog() {
  const debugLogPath = join(testDataDir, DEBUG_LOG_FILENAME);
  if (existsSync(debugLogPath)) {
    console.log(`[debug.log]\n${readFileSync(debugLogPath, "utf-8")}`);
  }
}

beforeAll(async () => {
  // Ensure the compiled binary exists
  if (!existsSync(MURMUR_BIN)) {
    throw new Error(`Compiled binary not found at ${MURMUR_BIN}. Run "bun run build" first.`);
  }

  // Create an isolated data directory
  testDataDir = mkdtempSync(join(tmpdir(), "murmur-verbose-e2e-"));

  // Create a test workspace with a HEARTBEAT.md that triggers a tool call
  testWorkspace = join(testDataDir, "test-workspace");
  mkdirSync(testWorkspace, { recursive: true });
  await Bun.write(join(testWorkspace, "HEARTBEAT.md"), TEST_HEARTBEAT);
  await Bun.write(join(testWorkspace, "status.txt"), STATUS_FILE_CONTENT);
});

afterAll(() => {
  // Clean up the temp directories
  if (testDataDir && existsSync(testDataDir)) {
    try {
      rmSync(testDataDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`afterAll: failed to clean up ${testDataDir}: ${err}`);
    }
  }
});

describe("murmur beat (default verbose) e2e", () => {
  test("default output shows tool calls with icons", async () => {
    const result = await murmur("beat", testWorkspace);
    expect(result.exitCode).toBe(0);

    // The cliEmitter prints "◆ ToolName target" for completed tool calls
    expect(result.stdout).toContain("◆");

    // The heartbeat asks Claude to `cat status.txt` via Bash,
    // so we expect a Bash tool call in the output
    expect(result.stdout).toMatch(/◆.*Bash/i);
  }, 120_000);

  test("default output shows conversation summary", async () => {
    const result = await murmur("beat", testWorkspace);
    expect(result.exitCode).toBe(0);

    // After completion, cli.ts prints "--- Conversation Summary ---"
    expect(result.stdout).toContain("--- Conversation Summary ---");

    // The result section reports agent turn count
    expect(result.stdout).toContain("Agent turns:");
  }, 120_000);

  test("conversation log is saved to data dir", async () => {
    const result = await murmur("beat", testWorkspace);
    expect(result.exitCode).toBe(0);

    // saveConversationLog writes to <data-dir>/last-beat-<slug>.json
    const slug = basename(testWorkspace).replace(/[^a-zA-Z0-9_-]/g, "_");
    const logPath = join(testDataDir, `last-beat-${slug}.json`);

    expect(existsSync(logPath)).toBe(true);

    // The file must contain valid JSON with conversation turns
    const content = readFileSync(logPath, "utf-8");
    const turns = JSON.parse(content);
    expect(Array.isArray(turns)).toBe(true);
    expect(turns.length).toBeGreaterThanOrEqual(1);

    // At least one turn should be from the assistant
    const assistantTurn = turns.find((t: { role: string }) => t.role === "assistant");
    expect(assistantTurn).toBeDefined();
  }, 120_000);

  test("quiet mode (--quiet) does NOT show tool details", async () => {
    const result = await murmur("beat", "--quiet", testWorkspace);
    expect(result.exitCode).toBe(0);

    // With --quiet, tool call icons are not shown
    expect(result.stdout).not.toContain("◆");

    // The conversation summary is only printed in default (non-quiet) mode
    expect(result.stdout).not.toContain("--- Conversation Summary ---");
    expect(result.stdout).not.toContain("Agent turns:");
  }, 120_000);

  test("cost is displayed in default output", async () => {
    const result = await murmur("beat", testWorkspace);
    expect(result.exitCode).toBe(0);

    // The conversation summary prints "Cost: $<amount>" for the result turn
    expect(result.stdout).toMatch(/Cost: \$[\d.]+/);
  }, 120_000);
});
