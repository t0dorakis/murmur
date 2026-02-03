import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PID_FILENAME } from "../src/config.ts";

const REPO_DIR = join(import.meta.dir, "..");
const CLI_PATH = join(REPO_DIR, "src/cli.ts");
const EXAMPLE_DIR = join(REPO_DIR, "example");
const JOKES_FILE = join(EXAMPLE_DIR, "jokes.txt");

let testDataDir: string;

async function murmur(...args: string[]) {
  const proc = Bun.spawn(["bun", CLI_PATH, "--data-dir", testDataDir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}

function jokeCount(): number {
  if (!existsSync(JOKES_FILE)) return 0;
  return readFileSync(JOKES_FILE, "utf-8").split("\n").filter(Boolean).length;
}

beforeAll(() => {
  testDataDir = mkdtempSync(join(tmpdir(), "murmur-e2e-"));
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
});

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
  }, 120_000);

  test("daemon lifecycle: start, scheduled beat, stop", async () => {
    const jokesBefore = jokeCount();

    // Write config with a 1s interval so it fires immediately
    const configFile = join(testDataDir, "config.json");
    writeFileSync(configFile, JSON.stringify({
      workspaces: [{
        path: EXAMPLE_DIR,
        interval: "1s",
        lastRun: null,
      }],
    }, null, 2));

    // Start daemon with fast tick
    const startResult = await murmur("start", "--tick", "5s");
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

    // Wait for daemon to tick and Claude to finish
    await Bun.sleep(50_000);

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

    // Status reports stopped
    const statusAfter = await murmur("status");
    expect(statusAfter.stdout).toContain("stopped");
  }, 120_000);
});
