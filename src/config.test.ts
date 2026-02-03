import { describe, expect, test } from "bun:test";
import { parseInterval, isDue } from "./config.ts";
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
});
