import { describe, expect, test } from "bun:test";
import { parseInterval, isDue, nextRunAt, validateWorkspace } from "./config.ts";
import type { WorkspaceConfig } from "./types.ts";

describe("parseInterval", () => {
  test("parses seconds", () => {
    expect(parseInterval("30s")).toBe(30_000);
    expect(parseInterval("1s")).toBe(1_000);
  });

  test("parses minutes", () => {
    expect(parseInterval("30m")).toBe(1_800_000);
    expect(parseInterval("1m")).toBe(60_000);
    expect(parseInterval("15m")).toBe(900_000);
  });

  test("parses hours", () => {
    expect(parseInterval("1h")).toBe(3_600_000);
    expect(parseInterval("2h")).toBe(7_200_000);
  });

  test("parses days", () => {
    expect(parseInterval("1d")).toBe(86_400_000);
  });

  test("throws on invalid input", () => {
    expect(() => parseInterval("")).toThrow();
    expect(() => parseInterval("30")).toThrow();
    expect(() => parseInterval("abc")).toThrow();
    expect(() => parseInterval("30x")).toThrow();
    expect(() => parseInterval("m30")).toThrow();
  });
});

describe("isDue", () => {
  const workspace = (lastRun: string | null, interval = "30m"): WorkspaceConfig => ({
    path: "/tmp/test",
    interval,
    lastRun,
  });

  test("returns true when lastRun is null", () => {
    expect(isDue(workspace(null))).toBe(true);
  });

  test("returns true when interval has elapsed", () => {
    const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60_000).toISOString();
    expect(isDue(workspace(thirtyOneMinutesAgo, "30m"))).toBe(true);
  });

  test("returns false when interval has not elapsed", () => {
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    expect(isDue(workspace(oneMinuteAgo, "30m"))).toBe(false);
  });

  test("returns true at exact boundary", () => {
    const exactlyThirtyMinutesAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    expect(isDue(workspace(exactlyThirtyMinutesAgo, "30m"))).toBe(true);
  });

  test("returns false for workspace with neither interval nor cron", () => {
    expect(isDue({ path: "/tmp/test", lastRun: null })).toBe(false);
  });
});

describe("isDue (cron)", () => {
  const cronWs = (lastRun: string | null, cron = "0 * * * *"): WorkspaceConfig => ({
    path: "/tmp/test",
    cron,
    lastRun,
  });

  test("returns true when lastRun is null", () => {
    expect(isDue(cronWs(null))).toBe(true);
  });

  test("returns true when past next cron occurrence", () => {
    // Cron is "0 * * * *" (every hour on the hour)
    // Last run was 61 minutes ago — next occurrence has passed
    const sixtyOneMinutesAgo = new Date(Date.now() - 61 * 60_000).toISOString();
    expect(isDue(cronWs(sixtyOneMinutesAgo))).toBe(true);
  });

  test("returns false when before next cron occurrence", () => {
    // Last run was 1 minute ago, cron fires every hour — not due yet
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    expect(isDue(cronWs(oneMinuteAgo))).toBe(false);
  });

  test("works with every-minute cron", () => {
    // "* * * * *" fires every minute
    const twoMinutesAgo = new Date(Date.now() - 2 * 60_000).toISOString();
    expect(isDue(cronWs(twoMinutesAgo, "* * * * *"))).toBe(true);
  });
});

describe("nextRunAt", () => {
  test("computes next run for interval workspace", () => {
    const lastRun = new Date(Date.now() - 10 * 60_000).toISOString();
    const ws: WorkspaceConfig = { path: "/tmp/test", interval: "30m", lastRun };
    const next = nextRunAt(ws);
    // Should be lastRun + 30 minutes
    const expected = new Date(lastRun).getTime() + 30 * 60_000;
    expect(next).toBe(expected);
  });

  test("returns now for interval workspace with no lastRun", () => {
    const ws: WorkspaceConfig = { path: "/tmp/test", interval: "30m", lastRun: null };
    const before = Date.now();
    const next = nextRunAt(ws);
    expect(next).toBeGreaterThanOrEqual(before);
    expect(next).toBeLessThanOrEqual(Date.now());
  });

  test("computes next run for cron workspace", () => {
    // Cron "0 * * * *" — every hour on the hour
    const lastRun = new Date(Date.now() - 10 * 60_000).toISOString();
    const ws: WorkspaceConfig = { path: "/tmp/test", cron: "0 * * * *", lastRun };
    const next = nextRunAt(ws);
    // Next run should be in the future (at the next hour mark after lastRun)
    expect(next).toBeGreaterThan(new Date(lastRun).getTime());
  });

  test("computes next run for cron workspace with no lastRun", () => {
    const ws: WorkspaceConfig = { path: "/tmp/test", cron: "0 * * * *", lastRun: null };
    const next = nextRunAt(ws);
    // Should be the next hour mark from now
    expect(next).toBeGreaterThan(Date.now());
  });
});

describe("validateWorkspace", () => {
  test("accepts valid interval workspace", () => {
    expect(validateWorkspace({ path: "/tmp/test", interval: "30m", lastRun: null })).toBeNull();
  });

  test("accepts valid cron workspace", () => {
    expect(validateWorkspace({ path: "/tmp/test", cron: "0 9 * * *", lastRun: null })).toBeNull();
  });

  test("accepts cron workspace with tz", () => {
    expect(validateWorkspace({ path: "/tmp/test", cron: "0 9 * * *", tz: "Europe/Berlin", lastRun: null })).toBeNull();
  });

  test("rejects workspace with both interval and cron", () => {
    const err = validateWorkspace({ path: "/tmp/test", interval: "30m", cron: "0 9 * * *", lastRun: null });
    expect(err).toContain("both");
  });

  test("rejects workspace with neither interval nor cron", () => {
    const err = validateWorkspace({ path: "/tmp/test", lastRun: null });
    expect(err).toContain("missing");
  });

  test("rejects invalid interval", () => {
    const err = validateWorkspace({ path: "/tmp/test", interval: "xyz", lastRun: null });
    expect(err).toContain("invalid interval");
  });

  test("rejects invalid cron expression", () => {
    const err = validateWorkspace({ path: "/tmp/test", cron: "not a cron", lastRun: null });
    expect(err).toContain("invalid cron");
  });

  test("rejects tz without cron", () => {
    const err = validateWorkspace({ path: "/tmp/test", interval: "30m", tz: "UTC", lastRun: null });
    expect(err).toContain("tz");
  });
});
