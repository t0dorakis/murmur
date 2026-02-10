import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setDataDir } from "./config.ts";
import {
  readActiveBeats,
  recordActiveBeat,
  removeActiveBeat,
  clearActiveBeats,
  getActiveBeatsPath,
} from "./active-beats.ts";
import { isProcessAlive } from "./process-utils.ts";

describe("active-beats", () => {
  const testDir = join(import.meta.dir, ".test-data", "active-beats-test");

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    setDataDir(testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("readActiveBeats returns empty object when file does not exist", () => {
    const beats = readActiveBeats();
    expect(beats).toEqual({});
  });

  it("recordActiveBeat creates file and stores entry", async () => {
    const id = "workspace/heartbeat";
    const pid = 12345;
    const workspace = "/path/to/workspace";

    await recordActiveBeat(id, pid, workspace);

    const beats = readActiveBeats();
    expect(beats[id]).toBeDefined();
    expect(beats[id]!.pid).toBe(pid);
    expect(beats[id]!.workspace).toBe(workspace);
    expect(beats[id]!.startedAt).toBeDefined();
  });

  it("removeActiveBeat removes entry from file", async () => {
    const id = "workspace/heartbeat";
    await recordActiveBeat(id, 12345, "/path");

    let beats = readActiveBeats();
    expect(beats[id]).toBeDefined();

    await removeActiveBeat(id);

    beats = readActiveBeats();
    expect(beats[id]).toBeUndefined();
  });

  it("clearActiveBeats removes the file", async () => {
    await recordActiveBeat("id1", 12345, "/path1");
    await recordActiveBeat("id2", 67890, "/path2");

    const path = getActiveBeatsPath();
    expect(existsSync(path)).toBe(true);

    await clearActiveBeats();
    expect(existsSync(path)).toBe(false);
  });

  it("recordActiveBeat preserves existing entries", async () => {
    await recordActiveBeat("id1", 11111, "/path1");
    await recordActiveBeat("id2", 22222, "/path2");

    const beats = readActiveBeats();
    expect(Object.keys(beats).length).toBe(2);
    expect(beats["id1"]!.pid).toBe(11111);
    expect(beats["id2"]!.pid).toBe(22222);
  });

  it("isProcessAlive returns true for current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("isProcessAlive returns false for non-existent PID", () => {
    // Use a high PID that's unlikely to exist
    const fakePid = 999999;
    expect(isProcessAlive(fakePid)).toBe(false);
  });

  it("readActiveBeats handles corrupt JSON gracefully", async () => {
    const path = getActiveBeatsPath();
    await Bun.write(path, "{ invalid json !");

    const beats = readActiveBeats();
    expect(beats).toEqual({});
  });

  it("readActiveBeats handles non-object JSON gracefully", async () => {
    const path = getActiveBeatsPath();
    await Bun.write(path, JSON.stringify([1, 2, 3]));

    const beats = readActiveBeats();
    expect(beats).toEqual({});
  });
});
