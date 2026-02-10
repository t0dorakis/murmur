import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PID_FILENAME } from "../src/config.ts";
import { DEBUG_LOG_FILENAME } from "../src/debug.ts";
import { ACTIVE_BEATS_FILENAME } from "../src/active-beats.ts";

/**
 * E2E tests for orphaned process recovery (issue #46).
 *
 * Verifies that when the daemon starts, it detects and recovers
 * orphaned agent processes from a previous crashed session by reading
 * active-beats.json and checking PIDs.
 *
 * Requirements:
 *   - Compiled murmur binary (run `bun run build` first)
 */

const REPO_DIR = join(import.meta.dir, "..");
const MURMUR_BIN = join(REPO_DIR, "murmur");

let testDataDir: string;

async function murmur(...args: string[]) {
  const proc = Bun.spawn([MURMUR_BIN, "--data-dir", testDataDir, "--debug", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
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

function killDaemonIfRunning() {
  const pidFile = join(testDataDir, PID_FILENAME);
  if (!existsSync(pidFile)) return;
  try {
    const pid = Number(readFileSync(pidFile, "utf-8").trim());
    process.kill(pid, "SIGTERM");
  } catch (err: any) {
    if (err?.code !== "ESRCH") console.error(`cleanup: failed to kill daemon: ${err}`);
  }
}

beforeAll(() => {
  if (!existsSync(MURMUR_BIN)) {
    throw new Error(`Compiled binary not found at ${MURMUR_BIN}. Run "bun run build" first.`);
  }
  testDataDir = mkdtempSync(join(tmpdir(), "murmur-recovery-e2e-"));
});

beforeEach(() => {
  killDaemonIfRunning();
});

afterAll(() => {
  killDaemonIfRunning();
});

describe("orphaned process recovery e2e", () => {
  test("daemon recovers dead processes from active-beats.json on startup", async () => {
    // Simulate a previous daemon crash by writing a stale active-beats.json
    // with a PID that no longer exists (use a very high PID unlikely to be alive)
    const fakeActiveBeats = {
      "test-workspace/HEARTBEAT.md": {
        pid: 99999999, // almost certainly not a real process
        startedAt: "2026-02-10T10:00:00Z",
        workspace: "/tmp/fake-workspace",
      },
    };

    writeFileSync(
      join(testDataDir, ACTIVE_BEATS_FILENAME),
      JSON.stringify(fakeActiveBeats, null, 2),
    );

    // Create a minimal workspace + config so the daemon can start
    const wsDir = join(testDataDir, "ws");
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(
      join(wsDir, "HEARTBEAT.md"),
      `---
interval: 1h
---

Say HEARTBEAT_OK.
`,
    );
    writeFileSync(
      join(testDataDir, "config.json"),
      JSON.stringify({ workspaces: [{ path: wsDir, lastRun: null }] }, null, 2),
    );

    // Start the daemon — it should detect and recover the orphaned beat
    const startResult = await murmur("start", "--detach", "--tick", "60s");
    expect(startResult.exitCode).toBe(0);

    // Give daemon a moment to start and run recovery
    await Bun.sleep(3_000);

    // Check debug log for recovery messages
    const debugLog = readDebugLog();
    expect(debugLog).toContain("[recovery] Found 1 active beat(s) from previous session");
    expect(debugLog).toContain("[recovery] Process already dead:");
    expect(debugLog).toContain("[recovery] Recovery complete");

    // active-beats.json should have been cleared
    const activeBeatsPath = join(testDataDir, ACTIVE_BEATS_FILENAME);
    expect(existsSync(activeBeatsPath)).toBe(false);

    // heartbeats.jsonl should have a "lost" entry
    const logFile = join(testDataDir, "heartbeats.jsonl");
    expect(existsSync(logFile)).toBe(true);
    const logContent = readFileSync(logFile, "utf-8");
    const entries = logContent
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const lostEntry = entries.find((e: any) => e.outcome === "lost");
    expect(lostEntry).toBeDefined();
    expect(lostEntry.summary).toContain("crashed or was killed");

    // Stop daemon
    const stopResult = await murmur("stop");
    expect(stopResult.exitCode).toBe(0);
  }, 30_000);

  test("daemon starts cleanly when no active-beats.json exists", async () => {
    // Ensure no stale file
    const activeBeatsPath = join(testDataDir, ACTIVE_BEATS_FILENAME);
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(activeBeatsPath);
    } catch {}

    // Create workspace + config
    const wsDir = join(testDataDir, "ws-clean");
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(
      join(wsDir, "HEARTBEAT.md"),
      `---
interval: 1h
---

Say HEARTBEAT_OK.
`,
    );
    writeFileSync(
      join(testDataDir, "config.json"),
      JSON.stringify({ workspaces: [{ path: wsDir, lastRun: null }] }, null, 2),
    );

    const startResult = await murmur("start", "--detach", "--tick", "60s");
    expect(startResult.exitCode).toBe(0);

    await Bun.sleep(2_000);

    const debugLog = readDebugLog();
    expect(debugLog).toContain("[recovery] No active beats to recover");

    const stopResult = await murmur("stop");
    expect(stopResult.exitCode).toBe(0);
  }, 20_000);
});
