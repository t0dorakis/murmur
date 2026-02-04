import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PID_FILENAME } from "../src/config.ts";
import { DEBUG_LOG_FILENAME } from "../src/debug.ts";

const REPO_DIR = join(import.meta.dir, "..");
const MURMUR_BIN = join(REPO_DIR, "murmur");
const EXAMPLE_DIR = join(REPO_DIR, "example");
const JOKES_FILE = join(EXAMPLE_DIR, "jokes.txt");
const SEED_JOKE = "Why don't penguins fly? They can't afford plane tickets.\n";

let testDataDir: string;

async function murmur(...args: string[]) {
  const proc = Bun.spawn([MURMUR_BIN, "--data-dir", testDataDir, "--debug", ...args], {
    stdout: "pipe",
    stderr: "pipe",
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

function jokeCount(): number {
  if (!existsSync(JOKES_FILE)) return 0;
  return readFileSync(JOKES_FILE, "utf-8").split("\n").filter(Boolean).length;
}

beforeAll(() => {
  if (!existsSync(MURMUR_BIN)) {
    throw new Error(`Compiled binary not found at ${MURMUR_BIN}. Run "bun run build" first.`);
  }
  testDataDir = mkdtempSync(join(tmpdir(), "murmur-e2e-"));
});

beforeEach(() => {
  writeFileSync(JOKES_FILE, SEED_JOKE);
});

afterAll(() => {
  // Kill daemon if still running
  const pidFile = join(testDataDir, PID_FILENAME);
  if (existsSync(pidFile)) {
    try {
      const pid = Number(readFileSync(pidFile, "utf-8").trim());
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  // Reset jokes file
  writeFileSync(JOKES_FILE, SEED_JOKE);
});

async function testDaemonLifecycle(
  workspaceConfig: Record<string, unknown>,
  statusAssertions?: (stdout: string) => void,
) {
  const jokesBefore = jokeCount();

  const configFile = join(testDataDir, "config.json");
  writeFileSync(configFile, JSON.stringify({
    workspaces: [{ path: EXAMPLE_DIR, lastRun: null, ...workspaceConfig }],
  }, null, 2));

  // Start daemon in background
  const startResult = await murmur("start", "--detach", "--tick", "5s");
  expect(startResult.exitCode).toBe(0);
  expect(startResult.stdout).toContain("Started");

  // PID file exists and process is alive
  const pidFile = join(testDataDir, PID_FILENAME);
  expect(existsSync(pidFile)).toBe(true);
  const daemonPid = Number(readFileSync(pidFile, "utf-8").trim());
  expect(() => process.kill(daemonPid, 0)).not.toThrow();

  // Status reports running
  const statusResult = await murmur("status");
  expect(statusResult.stdout).toContain("running");
  statusAssertions?.(statusResult.stdout);

  // Wait for daemon to tick and Claude to finish
  await Bun.sleep(20_000);

  // Daemon fired a heartbeat — lastRun updated
  const config = JSON.parse(readFileSync(configFile, "utf-8"));
  expect(config.workspaces[0].lastRun).not.toBeNull();

  // Claude did the work
  expect(jokeCount()).toBeGreaterThan(jokesBefore);

  // Stop daemon
  const stopResult = await murmur("stop");
  expect(stopResult.exitCode).toBe(0);
  expect(stopResult.stdout).toContain("Stopped");

  await Bun.sleep(1_000);

  // PID file cleaned up and process gone
  expect(existsSync(pidFile)).toBe(false);
  expect(() => process.kill(daemonPid, 0)).toThrow();
}

describe("e2e", () => {
  test("murmur beat fires a real heartbeat", async () => {
    const jokesBefore = jokeCount();

    const result = await murmur("beat", EXAMPLE_DIR);
    expect(result.exitCode).toBe(0);

    // Log file created with a valid entry
    const logFile = join(testDataDir, "heartbeats.jsonl");
    expect(existsSync(logFile)).toBe(true);

    const logContent = readFileSync(logFile, "utf-8");
    expect(logContent).toContain('"outcome"');
    expect(logContent).not.toContain('"outcome":"error"');

    // Claude actually did the work
    expect(jokeCount()).toBeGreaterThan(jokesBefore);
  }, 60_000);

  test("daemon lifecycle: start, scheduled beat, stop", async () => {
    await testDaemonLifecycle({ interval: "1s" });

    // Status reports stopped after lifecycle completes
    const statusAfter = await murmur("status");
    expect(statusAfter.stdout).toContain("stopped");
  }, 60_000);

  test("daemon lifecycle with cron: start, scheduled beat, stop", async () => {
    await testDaemonLifecycle(
      { cron: "* * * * *" },
      (stdout) => expect(stdout).toContain("cron"),
    );
  }, 60_000);
});
