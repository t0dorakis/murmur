import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PID_FILENAME } from "../src/config.ts";
import { DEBUG_LOG_FILENAME } from "../src/debug.ts";

const REPO_DIR = join(import.meta.dir, "..");
const MURMUR_BIN = join(REPO_DIR, "murmur");

const PROMPT_BODY = `Add a new penguin joke to \`jokes.txt\` in this directory. One joke per heartbeat.
If the file doesn't exist, create it. Append to the end, don't overwrite existing jokes.
Number each joke sequentially.

Then respond with \`HEARTBEAT_OK\`.
`;

const SEED_JOKE = "Why don't penguins fly? They can't afford plane tickets.\n";

let testDataDir: string;
let testId = 0;

/** Create a temp workspace dir with HEARTBEAT.md and seed jokes.txt */
function createWorkspace(frontmatter: Record<string, string | number>): string {
  const wsDir = join(testDataDir, `ws-${testId++}`);
  mkdirSync(wsDir, { recursive: true });

  writeHeartbeat(wsDir, "HEARTBEAT.md", frontmatter);
  writeFileSync(join(wsDir, "jokes.txt"), SEED_JOKE);

  return wsDir;
}

/** Write a HEARTBEAT.md with frontmatter at a relative path within wsDir */
function writeHeartbeat(
  wsDir: string,
  relativePath: string,
  frontmatter: Record<string, string | number>,
): void {
  const fmLines = Object.entries(frontmatter).map(([k, v]) =>
    typeof v === "string" ? `${k}: "${v}"` : `${k}: ${v}`,
  );
  const heartbeat = `---\n${fmLines.join("\n")}\n---\n\n${PROMPT_BODY}`;
  const absPath = join(wsDir, relativePath);
  mkdirSync(join(absPath, ".."), { recursive: true });
  writeFileSync(absPath, heartbeat);
}

function jokeCount(wsDir: string): number {
  const jokesFile = join(wsDir, "jokes.txt");
  if (!existsSync(jokesFile)) return 0;
  return readFileSync(jokesFile, "utf-8").split("\n").filter(Boolean).length;
}

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
  testDataDir = mkdtempSync(join(tmpdir(), "murmur-e2e-"));
});

beforeEach(() => {
  killDaemonIfRunning();
});

afterAll(() => {
  killDaemonIfRunning();
});

async function testDaemonLifecycle(
  workspaceConfig: Record<string, string | number>,
  statusAssertions?: (stdout: string) => void,
  { waitMs = 10_000 }: { waitMs?: number } = {},
) {
  const wsDir = createWorkspace(workspaceConfig);
  const jokesBefore = jokeCount(wsDir);

  const configFile = join(testDataDir, "config.json");
  writeFileSync(
    configFile,
    JSON.stringify(
      {
        workspaces: [{ path: wsDir, lastRun: null }],
      },
      null,
      2,
    ),
  );

  // Start daemon in background
  const startResult = await murmur("start", "--detach", "--tick", "5s");
  expect(startResult.exitCode).toBe(0);
  expect(startResult.stdout).toContain("Daemon started");

  // PID file exists and process is alive
  const pidFile = join(testDataDir, PID_FILENAME);
  expect(existsSync(pidFile)).toBe(true);
  const daemonPid = Number(readFileSync(pidFile, "utf-8").trim());
  expect(() => process.kill(daemonPid, 0)).not.toThrow();

  // Status reports running
  const statusResult = await murmur("status");
  expect(statusResult.stdout).toContain("running");
  statusAssertions?.(statusResult.stdout);

  // Wait for daemon to tick and agent to finish
  await Bun.sleep(waitMs);

  // Daemon fired a heartbeat — lastRun updated
  const config = JSON.parse(readFileSync(configFile, "utf-8"));
  expect(config.workspaces[0].lastRun).not.toBeNull();

  // Claude did the work
  expect(jokeCount(wsDir)).toBeGreaterThan(jokesBefore);

  // Stop daemon
  const stopResult = await murmur("stop");
  expect(stopResult.exitCode).toBe(0);
  expect(stopResult.stdout).toContain("Daemon stopped");

  await Bun.sleep(1_000);

  // PID file cleaned up and process gone
  expect(existsSync(pidFile)).toBe(false);
  expect(() => process.kill(daemonPid, 0)).toThrow();
}

describe("e2e", () => {
  test("murmur beat fires a real heartbeat (claude-code)", async () => {
    const wsDir = createWorkspace({
      agent: "claude-code",
      model: "haiku",
      maxTurns: 50,
    });
    const jokesBefore = jokeCount(wsDir);

    const result = await murmur("beat", wsDir);
    expect(result.exitCode).toBe(0);

    // Log file created with a valid entry
    const logFile = join(testDataDir, "heartbeats.jsonl");
    expect(existsSync(logFile)).toBe(true);

    const logContent = readFileSync(logFile, "utf-8");
    expect(logContent).toContain('"outcome"');
    expect(logContent).not.toContain('"outcome":"error"');

    // Claude actually did the work
    expect(jokeCount(wsDir)).toBeGreaterThan(jokesBefore);
  }, 60_000);

  test("murmur beat with pi agent", async () => {
    const wsDir = createWorkspace({ agent: "pi", maxTurns: 50 });
    const jokesBefore = jokeCount(wsDir);

    const result = await murmur("beat", wsDir);
    expect(result.exitCode).toBe(0);

    // Log file created with a valid entry
    const logFile = join(testDataDir, "heartbeats.jsonl");
    expect(existsSync(logFile)).toBe(true);

    const logContent = readFileSync(logFile, "utf-8");
    expect(logContent).toContain('"outcome"');
    expect(logContent).not.toContain('"outcome":"error"');

    // Pi actually did the work
    expect(jokeCount(wsDir)).toBeGreaterThan(jokesBefore);

    // Verify pi agent was used in the log
    const lastLine = logContent.trim().split("\n").pop();
    expect(lastLine).toBeTruthy();
    const entry = JSON.parse(lastLine!);
    expect(entry.turns).toBeTruthy();
    expect(entry.turns.length).toBeGreaterThan(0);
  }, 60_000);

  test("murmur beat with codex agent", async () => {
    const wsDir = createWorkspace({ agent: "codex", maxTurns: 50 });
    const jokesBefore = jokeCount(wsDir);

    const result = await murmur("beat", wsDir);
    expect(result.exitCode).toBe(0);

    // Log file created with a valid entry
    const logFile = join(testDataDir, "heartbeats.jsonl");
    expect(existsSync(logFile)).toBe(true);

    const logContent = readFileSync(logFile, "utf-8");
    const lastLine = logContent.trim().split("\n").pop();
    expect(lastLine).toBeTruthy();
    const entry = JSON.parse(lastLine!);
    expect(entry.outcome).not.toBe("error");

    // Codex actually did the work
    expect(jokeCount(wsDir)).toBeGreaterThan(jokesBefore);

    // Verify turns were captured
    expect(entry.turns).toBeTruthy();
    expect(entry.turns.length).toBeGreaterThan(0);
  }, 120_000);

  test("daemon lifecycle: start, scheduled beat, stop", async () => {
    await testDaemonLifecycle({
      interval: "1s",
      agent: "claude-code",
      model: "haiku",
      maxTurns: 50,
    });

    // Status reports stopped after lifecycle completes
    const statusAfter = await murmur("status");
    expect(statusAfter.stdout).toContain("stopped");
  }, 60_000);

  test("daemon lifecycle with cron: start, scheduled beat, stop", async () => {
    await testDaemonLifecycle(
      { cron: "* * * * *", agent: "claude-code", model: "haiku", maxTurns: 50 },
      (stdout) => expect(stdout).toContain("cron"),
    );
  }, 60_000);

  test("daemon lifecycle with pi agent", async () => {
    await testDaemonLifecycle({ agent: "pi", interval: "1s", maxTurns: 50 }, undefined, {
      waitMs: 30_000,
    });

    // Status reports stopped after lifecycle completes
    const statusAfter = await murmur("status");
    expect(statusAfter.stdout).toContain("stopped");
  }, 60_000);

  test("daemon lifecycle with codex agent", async () => {
    await testDaemonLifecycle({ agent: "codex", interval: "1s", maxTurns: 50 }, undefined, {
      waitMs: 30_000,
    });

    // Status reports stopped after lifecycle completes
    const statusAfter = await murmur("status");
    expect(statusAfter.stdout).toContain("stopped");
  }, 120_000);

  test("multi-heartbeat: beat --name runs a named heartbeat", async () => {
    const wsDir = join(testDataDir, `ws-${testId++}`);
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(join(wsDir, "jokes.txt"), SEED_JOKE);

    // Create a named heartbeat in heartbeats/penguin-jokes/
    writeHeartbeat(wsDir, "heartbeats/penguin-jokes/HEARTBEAT.md", {
      agent: "claude-code",
      model: "haiku",
      maxTurns: 50,
      interval: "1h",
    });

    const jokesBefore = jokeCount(wsDir);

    const result = await murmur("beat", wsDir, "--name", "penguin-jokes");
    expect(result.exitCode).toBe(0);

    // Log entry uses compound heartbeat ID
    const logFile = join(testDataDir, "heartbeats.jsonl");
    const logContent = readFileSync(logFile, "utf-8");
    expect(logContent).toContain("heartbeats/penguin-jokes/HEARTBEAT.md");
    expect(logContent).not.toContain('"outcome":"error"');

    // Agent ran with repo root as CWD and modified jokes.txt
    expect(jokeCount(wsDir)).toBeGreaterThan(jokesBefore);
  }, 60_000);

  test("multi-heartbeat: status shows expanded heartbeats", async () => {
    const wsDir = join(testDataDir, `ws-${testId++}`);
    mkdirSync(wsDir, { recursive: true });

    // Root heartbeat + two named heartbeats
    writeHeartbeat(wsDir, "HEARTBEAT.md", { interval: "1h" });
    writeHeartbeat(wsDir, "heartbeats/alpha/HEARTBEAT.md", { interval: "30m" });
    writeHeartbeat(wsDir, "heartbeats/beta/HEARTBEAT.md", { interval: "2h" });

    const configFile = join(testDataDir, "config.json");
    writeFileSync(
      configFile,
      JSON.stringify({ workspaces: [{ path: wsDir, lastRun: null }] }, null, 2),
    );

    const result = await murmur("status");
    expect(result.exitCode).toBe(0);

    // All three heartbeats should appear in status output
    expect(result.stdout).toContain("Heartbeats (3");
    expect(result.stdout).toContain("alpha");
    expect(result.stdout).toContain("beta");
  }, 15_000);
});
