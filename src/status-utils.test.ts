import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setDataDir } from "./config.ts";
import { checkWorkspaceHealth, readRecentErrors, getLastOutcome } from "./status-utils.ts";

describe("checkWorkspaceHealth", () => {
  test("reports missing path", () => {
    const health = checkWorkspaceHealth("/nonexistent/path/12345");
    expect(health.pathExists).toBe(false);
    expect(health.heartbeatExists).toBe(false);
  });

  test("reports missing HEARTBEAT.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "murmur-health-"));
    const health = checkWorkspaceHealth(dir);
    expect(health.pathExists).toBe(true);
    expect(health.heartbeatExists).toBe(false);
  });

  test("reports healthy workspace", () => {
    const dir = mkdtempSync(join(tmpdir(), "murmur-health-"));
    writeFileSync(join(dir, "HEARTBEAT.md"), "# Heartbeat\n");
    const health = checkWorkspaceHealth(dir);
    expect(health.pathExists).toBe(true);
    expect(health.heartbeatExists).toBe(true);
  });
});

describe("readRecentErrors", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "murmur-log-"));
    setDataDir(dir);
  });

  test("returns empty when no log file", () => {
    expect(readRecentErrors()).toEqual([]);
  });

  test("returns only non-ok entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "murmur-log-"));
    setDataDir(dir);

    const now = new Date().toISOString();
    const entries = [
      JSON.stringify({ ts: now, workspace: "/a", outcome: "ok", durationMs: 100 }),
      JSON.stringify({
        ts: now,
        workspace: "/b",
        outcome: "error",
        durationMs: 200,
        error: "timeout",
      }),
      JSON.stringify({
        ts: now,
        workspace: "/c",
        outcome: "attention",
        durationMs: 300,
        summary: "2 items",
      }),
    ];
    writeFileSync(join(dir, "heartbeats.jsonl"), entries.join("\n") + "\n");

    const errors = readRecentErrors();
    expect(errors.length).toBe(2);
    expect(errors[0]!.outcome).toBe("attention");
    expect(errors[1]!.outcome).toBe("error");
  });

  test("respects limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "murmur-log-"));
    setDataDir(dir);

    const now = new Date().toISOString();
    const entries = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({
        ts: now,
        workspace: `/ws-${i}`,
        outcome: "error",
        durationMs: 100,
        error: `err-${i}`,
      }),
    );
    writeFileSync(join(dir, "heartbeats.jsonl"), entries.join("\n") + "\n");

    const errors = readRecentErrors(3);
    expect(errors.length).toBe(3);
  });

  test("skips entries older than withinMs", () => {
    const dir = mkdtempSync(join(tmpdir(), "murmur-log-"));
    setDataDir(dir);

    const old = new Date(Date.now() - 100_000_000).toISOString();
    const recent = new Date().toISOString();
    const entries = [
      JSON.stringify({
        ts: old,
        workspace: "/old",
        outcome: "error",
        durationMs: 100,
        error: "old",
      }),
      JSON.stringify({
        ts: recent,
        workspace: "/new",
        outcome: "error",
        durationMs: 100,
        error: "new",
      }),
    ];
    writeFileSync(join(dir, "heartbeats.jsonl"), entries.join("\n") + "\n");

    const errors = readRecentErrors(5, 86_400_000);
    expect(errors.length).toBe(1);
    expect(errors[0]!.workspace).toBe("/new");
  });
});

describe("getLastOutcome", () => {
  test("returns null when no log file", () => {
    const dir = mkdtempSync(join(tmpdir(), "murmur-log-"));
    setDataDir(dir);
    expect(getLastOutcome("/some/path")).toBeNull();
  });

  test("finds last matching entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "murmur-log-"));
    setDataDir(dir);

    const entries = [
      JSON.stringify({
        ts: "2026-01-01T00:00:00Z",
        workspace: "/a",
        outcome: "error",
        durationMs: 100,
      }),
      JSON.stringify({
        ts: "2026-01-02T00:00:00Z",
        workspace: "/a",
        outcome: "ok",
        durationMs: 100,
      }),
      JSON.stringify({
        ts: "2026-01-03T00:00:00Z",
        workspace: "/b",
        outcome: "attention",
        durationMs: 100,
      }),
    ];
    writeFileSync(join(dir, "heartbeats.jsonl"), entries.join("\n") + "\n");

    const result = getLastOutcome("/a");
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("ok");
    expect(result!.ts).toBe("2026-01-02T00:00:00Z");
  });

  test("returns null for unknown workspace", () => {
    const dir = mkdtempSync(join(tmpdir(), "murmur-log-"));
    setDataDir(dir);

    const entries = [
      JSON.stringify({
        ts: "2026-01-01T00:00:00Z",
        workspace: "/a",
        outcome: "ok",
        durationMs: 100,
      }),
    ];
    writeFileSync(join(dir, "heartbeats.jsonl"), entries.join("\n") + "\n");

    expect(getLastOutcome("/nonexistent")).toBeNull();
  });
});
