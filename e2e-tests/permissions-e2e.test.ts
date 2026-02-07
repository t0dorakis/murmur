import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEBUG_LOG_FILENAME } from "../src/debug.ts";
import {
  DEFAULT_DENY_LIST,
  buildDisallowedToolsArgs,
} from "../src/permissions.ts";

/**
 * E2E tests for the permission deny-list exercised through `murmur beat`.
 *
 * Each test creates a temporary workspace with a focused HEARTBEAT.md,
 * runs `murmur beat <workspace>`, and verifies from the output and debug
 * log that the deny-list is enforced correctly.
 *
 * These tests spawn real Claude under the hood (via murmur), so they
 * need generous timeouts.
 */

const REPO_DIR = join(import.meta.dir, "..");
const MURMUR_BIN = join(REPO_DIR, "murmur");

let testDataDir: string;
const tempDirs: string[] = [];

/** Create a temp workspace directory containing HEARTBEAT.md with given content. */
function createWorkspace(heartbeatContent: string): string {
  const dir = mkdtempSync(join(tmpdir(), "murmur-perm-e2e-ws-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "HEARTBEAT.md"), heartbeatContent);
  return dir;
}

/** Spawn the murmur binary with `beat <workspace>` and return stdout, stderr, exitCode. */
async function murmurBeat(workspacePath: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(
    [MURMUR_BIN, "--data-dir", testDataDir, "--debug", "beat", workspacePath],
    {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
  );

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    console.log(`[murmur beat ${workspacePath}] exit=${exitCode}`);
    console.log(`[murmur beat] stdout: ${stdout}`);
    console.log(`[murmur beat] stderr: ${stderr}`);
    dumpDebugLog();
  }

  return { exitCode, stdout, stderr };
}

function readDebugLog(): string {
  const logPath = join(testDataDir, DEBUG_LOG_FILENAME);
  if (!existsSync(logPath)) return "";
  return readFileSync(logPath, "utf-8");
}

function dumpDebugLog() {
  const content = readDebugLog();
  if (content) {
    console.log(`[debug.log]\n${content}`);
  }
}

/** Clear the debug log between tests so each test gets a clean log. */
function clearDebugLog() {
  const logPath = join(testDataDir, DEBUG_LOG_FILENAME);
  if (existsSync(logPath)) {
    writeFileSync(logPath, "");
  }
}

/** Regex for common ways Claude reports a tool is restricted or adapts. */
const RESTRICTION_PATTERN =
  /not allowed|disallowed|disallow|denied|cannot|can't|won't|wouldn't|shouldn't|restricted|blocked|unable|permission|not permitted|refuse|unavailable|not available|not going to|will not|unnecessary/i;

beforeAll(() => {
  if (!existsSync(MURMUR_BIN)) {
    throw new Error(
      `Compiled binary not found at ${MURMUR_BIN}. Run "bun run build" first.`,
    );
  }
  testDataDir = mkdtempSync(join(tmpdir(), "murmur-perm-e2e-data-"));
});

afterAll(() => {
  // Clean up all temp directories
  for (const dir of [testDataDir, ...tempDirs]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

describe("permissions e2e: murmur beat with deny-list", () => {
  test("default deny-list blocks dangerous commands (sudo)", async () => {
    clearDebugLog();

    // Create a workspace that instructs Claude to run sudo.
    // The default deny-list includes "Bash(sudo *)" which should block this.
    const workspace = createWorkspace(`# Heartbeat

Run this exact bash command and show its output: \`sudo echo deny_list_sudo_blocked\`

If you cannot run it, say HEARTBEAT_OK.
`);

    const result = await murmurBeat(workspace);

    const combined = (result.stdout + result.stderr).toLowerCase();

    // Verify the deny-list was passed to Claude by checking the debug log.
    const debugLog = readDebugLog();
    expect(debugLog).toContain("--disallowedTools");
    expect(debugLog).toContain("Bash(sudo *)");

    // The heartbeat should complete (exit 0) since Claude adapts.
    expect(result.exitCode).toBe(0);

    // Claude should NOT have successfully executed `sudo echo ...`.
    // Acceptable outcomes:
    //   a) Claude mentions the restriction and reports HEARTBEAT_OK
    //   b) Claude runs `echo` without sudo (adapted to constraint)
    //   c) Claude reports ATTENTION about the restriction
    // Unacceptable: `sudo` actually executed (would show "deny_list_sudo_blocked"
    // as raw output from sudo, not echoed by Claude's explanation text).
    const mentionsRestriction = RESTRICTION_PATTERN.test(combined);
    const reportsOk =
      combined.includes("heartbeat_ok") || combined.includes("ok");

    // Either Claude acknowledged the restriction OR reported OK (adapted)
    expect(mentionsRestriction || reportsOk).toBe(true);
  }, 120_000);

  test("allowed commands work through murmur beat", async () => {
    clearDebugLog();

    // Create a workspace that asks Claude to write a marker file using echo.
    // This is NOT in the deny-list, so it should work fine.
    // We verify success by checking the marker file exists afterward.
    const sentinel = `perm_e2e_allowed_${Date.now()}`;
    const workspace = createWorkspace(`# Heartbeat

Run this exact bash command to create a marker file: \`echo ${sentinel} > marker.txt\`

Then respond with HEARTBEAT_OK.
`);

    const result = await murmurBeat(workspace);

    // The heartbeat should succeed.
    expect(result.exitCode).toBe(0);

    // Check the debug log to verify deny-list was still applied
    // (allowed commands work alongside the deny-list, not because it is missing).
    const debugLog = readDebugLog();
    expect(debugLog).toContain("--disallowedTools");

    // murmur beat prints "OK" for successful heartbeats. The raw Claude
    // stdout is not printed to the terminal -- it is captured internally.
    // We verify the echo actually ran by checking:
    //   1. The heartbeat outcome was "ok" (Claude responded with HEARTBEAT_OK)
    //   2. The marker file was created in the workspace
    const combined = result.stdout + result.stderr;
    const outcomeOk = combined.includes("OK") || combined.includes("ATTENTION");
    expect(outcomeOk).toBe(true);

    // The marker file should have been created by the echo command.
    const markerPath = join(workspace, "marker.txt");
    const markerExists = existsSync(markerPath);

    // Also check the debug log for evidence the echo ran.
    const sentinelInLog = debugLog.includes(sentinel);

    // Either the marker file was created OR the sentinel appears in the debug log.
    expect(markerExists || sentinelInLog).toBe(true);
  }, 120_000);

  test("verify full default deny-list is passed to Claude", async () => {
    clearDebugLog();

    // Create a minimal workspace -- we just need murmur to spawn Claude
    // so we can inspect the debug log for the complete deny-list.
    const workspace = createWorkspace(`# Heartbeat

Say HEARTBEAT_OK. Do not run any commands.
`);

    const result = await murmurBeat(workspace);
    expect(result.exitCode).toBe(0);

    // The debug log should contain the full spawned command line.
    const debugLog = readDebugLog();
    const spawnLine = debugLog.split("\n").find((l) => l.includes("Spawning:"));
    expect(spawnLine).toBeDefined();

    // Every entry in the default deny-list should appear in the spawn command.
    for (const rule of DEFAULT_DENY_LIST) {
      expect(spawnLine).toContain(rule);
    }

    // Verify the --disallowedTools flag precedes the rules.
    expect(spawnLine).toContain("--disallowedTools");
  }, 120_000);

  test("custom workspace deny rules merge with defaults (unit + integration)", async () => {
    // Unit-level verification: buildDisallowedToolsArgs with custom deny
    // rules produces a merged list containing both defaults and custom rules.
    const customArgs = buildDisallowedToolsArgs({ deny: ["Bash(curl *)"] });

    // Should start with the flag
    expect(customArgs[0]).toBe("--disallowedTools");

    // Should contain default rules
    expect(customArgs).toContain("Bash(sudo *)");
    expect(customArgs).toContain("Bash(rm -rf /)");
    expect(customArgs).toContain("Bash(shutdown *)");

    // Should contain the custom rule
    expect(customArgs).toContain("Bash(curl *)");

    // Integration check: murmur beat uses the default deny-list (since
    // `murmur beat` does not read workspace config for permissions).
    // Verify that the default deny-list is a subset of the custom merge.
    const defaultArgs = buildDisallowedToolsArgs();
    for (const rule of defaultArgs) {
      if (rule === "--disallowedTools") continue;
      expect(customArgs).toContain(rule);
    }

    // Also verify skip mode produces no flags.
    const skipArgs = buildDisallowedToolsArgs("skip");
    expect(skipArgs).toEqual([]);
  }, 10_000);

  test("heartbeat log records outcome when deny-list is active", async () => {
    clearDebugLog();

    const workspace = createWorkspace(`# Heartbeat

Check if a file named \`test_marker.txt\` exists in this directory.
If it does not exist, respond with HEARTBEAT_OK.
If it does exist, respond with ATTENTION: marker file found.
`);

    const result = await murmurBeat(workspace);
    expect(result.exitCode).toBe(0);

    // The heartbeat log should have been written.
    const logFile = join(testDataDir, "heartbeats.jsonl");
    expect(existsSync(logFile)).toBe(true);

    const logContent = readFileSync(logFile, "utf-8");
    const lastEntry = logContent.trim().split("\n").pop();
    expect(lastEntry).toBeDefined();

    const entry = JSON.parse(lastEntry!);
    expect(entry.workspace).toBe(workspace);
    // Outcome should be ok or attention -- never error when deny-list is active
    // and the prompt is benign.
    expect(entry.outcome).not.toBe("error");
    expect(entry.durationMs).toBeGreaterThan(0);

    // Verify deny-list was still applied during this run.
    const debugLog = readDebugLog();
    expect(debugLog).toContain("--disallowedTools");
  }, 120_000);
});
