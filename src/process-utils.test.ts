import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setDataDir, getPidPath } from "./config.ts";
import { isProcessAlive, readPid, killProcess } from "./process-utils.ts";

describe("process-utils", () => {
  const testDir = join(import.meta.dir, ".test-data", "process-utils-test");

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

  describe("isProcessAlive", () => {
    it("returns true for current process", () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it("returns false for non-existent PID", () => {
      const fakePid = 999999;
      expect(isProcessAlive(fakePid)).toBe(false);
    });
  });

  describe("readPid", () => {
    it("returns null when PID file does not exist", () => {
      const pid = readPid();
      expect(pid).toBeNull();
    });

    it("reads valid PID from file", () => {
      const pidPath = getPidPath();
      writeFileSync(pidPath, "12345");

      const pid = readPid();
      expect(pid).toBe(12345);
    });

    it("returns null for invalid PID content", () => {
      const pidPath = getPidPath();
      writeFileSync(pidPath, "not-a-number");

      const pid = readPid();
      expect(pid).toBeNull();
    });

    it("trims whitespace from PID file", () => {
      const pidPath = getPidPath();
      writeFileSync(pidPath, "  54321  \n");

      const pid = readPid();
      expect(pid).toBe(54321);
    });
  });

  describe("killProcess", () => {
    it("returns false for non-existent PID", () => {
      const fakePid = 999999;
      expect(killProcess(fakePid)).toBe(false);
    });

    it("returns true when signal is sent to existing process", () => {
      // We can't test killing an actual process, but we can test sending signal 0
      // which doesn't actually kill but checks if the process exists
      expect(killProcess(process.pid, 0 as NodeJS.Signals)).toBe(true);
    });
  });
});
