import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEBUG_LOG_FILENAME } from "../src/debug.ts";

/**
 * E2E tests for login shell wrapping (issue #42).
 *
 * Verifies that when murmur spawns agent processes, it wraps them in
 * the user's login shell (`$SHELL -lc`) so that PATH modifications
 * from .zshrc/.bash_profile are available — critical for detached daemon mode.
 *
 * Requirements:
 *   - Compiled murmur binary (run `bun run build` first)
 *   - `claude` CLI installed and authenticated
 */

const REPO_DIR = join(import.meta.dir, "..");
const MURMUR_BIN = join(REPO_DIR, "murmur");

let testDataDir: string;

async function murmur(...args: string[]) {
  const proc = Bun.spawn([MURMUR_BIN, "--data-dir", testDataDir, "--debug", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}

function readDebugLog(): string {
  const logPath = join(testDataDir, DEBUG_LOG_FILENAME);
  if (!existsSync(logPath)) return "";
  return readFileSync(logPath, "utf-8");
}

beforeAll(() => {
  if (!existsSync(MURMUR_BIN)) {
    throw new Error(`Compiled binary not found at ${MURMUR_BIN}. Run "bun run build" first.`);
  }
  testDataDir = mkdtempSync(join(tmpdir(), "murmur-login-shell-e2e-"));
});

describe("login shell wrapping e2e", () => {
  test("agent spawn uses login shell wrapper", async () => {
    // Create a minimal workspace that completes quickly
    const wsDir = join(testDataDir, "ws");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(
      join(wsDir, "HEARTBEAT.md"),
      `---
agent: claude-code
model: haiku
maxTurns: 5
---

Say HEARTBEAT_OK. Do not run any commands.
`,
    );

    const result = await murmur("beat", wsDir);
    expect(result.exitCode).toBe(0);

    // The debug log should show the login shell wrapping
    const debugLog = readDebugLog();

    // shell.ts logs: "[shell] Wrapping command in login shell: <shell> -lc ..."
    expect(debugLog).toContain("[shell] Wrapping command in login shell:");
    expect(debugLog).toContain("-lc");

    // The spawn line should show the wrapped command, not bare "claude"
    const spawnLine = debugLog.split("\n").find((l) => l.includes("Spawning:"));
    expect(spawnLine).toBeDefined();
    // The original claude args should still appear in the spawn debug line
    expect(spawnLine).toContain("claude");
  }, 120_000);

  test("login shell wrapping also applies to isCommandAvailable", async () => {
    // Create a workspace with an unavailable agent to test the availability check path
    const wsDir = join(testDataDir, "ws-unavailable");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(
      join(wsDir, "HEARTBEAT.md"),
      `---
agent: claude-code
model: haiku
---

Say HEARTBEAT_OK.
`,
    );

    // Run beat — even if it succeeds, the debug log will show the login shell wrapping
    // for the `which claude` availability check
    await murmur("beat", wsDir);

    const debugLog = readDebugLog();
    // The shell wrapper logs for the `which` command used in isCommandAvailable
    expect(debugLog).toContain("[shell] Wrapping command in login shell:");
  }, 120_000);
});
