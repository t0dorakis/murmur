import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setDataDir, getConfigPath } from "./config.ts";
import { listWorkspaces, removeWorkspace, clearWorkspaces } from "./workspaces.ts";

const TEST_DIR = "/tmp/murmur-workspaces-test";

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  setDataDir(TEST_DIR);
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeTestConfig(workspaces: Array<{ path: string; interval?: string; cron?: string; lastRun: string | null }>) {
  writeFileSync(getConfigPath(), JSON.stringify({ workspaces }, null, 2));
}

describe("listWorkspaces", () => {
  test("lists empty config", () => {
    writeTestConfig([]);
    // Just verify it doesn't throw
    listWorkspaces();
  });

  test("lists workspaces", () => {
    writeTestConfig([
      { path: "/test/path1", interval: "1h", lastRun: null },
      { path: "/test/path2", cron: "0 9 * * *", lastRun: "2026-01-01T00:00:00Z" },
    ]);
    listWorkspaces();
  });
});

describe("removeWorkspace", () => {
  test("removes existing workspace", async () => {
    writeTestConfig([
      { path: "/test/path1", interval: "1h", lastRun: null },
      { path: "/test/path2", interval: "30m", lastRun: null },
    ]);

    const result = await removeWorkspace("/test/path1");
    expect(result).toBe(true);

    const config = JSON.parse(await Bun.file(getConfigPath()).text());
    expect(config.workspaces).toHaveLength(1);
    expect(config.workspaces[0].path).toBe("/test/path2");
  });

  test("returns false for non-existent workspace", async () => {
    writeTestConfig([{ path: "/test/path1", interval: "1h", lastRun: null }]);

    const result = await removeWorkspace("/nonexistent");
    expect(result).toBe(false);

    const config = JSON.parse(await Bun.file(getConfigPath()).text());
    expect(config.workspaces).toHaveLength(1);
  });

  test("normalizes relative paths", async () => {
    const absolutePath = join(process.cwd(), "relative/path");
    writeTestConfig([{ path: absolutePath, interval: "1h", lastRun: null }]);

    const result = await removeWorkspace("relative/path");
    expect(result).toBe(true);

    const config = JSON.parse(await Bun.file(getConfigPath()).text());
    expect(config.workspaces).toHaveLength(0);
  });
});

describe("clearWorkspaces", () => {
  test("clears all workspaces", async () => {
    writeTestConfig([
      { path: "/test/path1", interval: "1h", lastRun: null },
      { path: "/test/path2", interval: "30m", lastRun: null },
      { path: "/test/path3", cron: "0 9 * * *", lastRun: null },
    ]);

    const result = await clearWorkspaces();
    expect(result).toBe(true);

    const config = JSON.parse(await Bun.file(getConfigPath()).text());
    expect(config.workspaces).toHaveLength(0);
  });

  test("handles already empty config", async () => {
    writeTestConfig([]);
    const result = await clearWorkspaces();
    expect(result).toBe(true);

    const config = JSON.parse(await Bun.file(getConfigPath()).text());
    expect(config.workspaces).toHaveLength(0);
  });
});
