import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  heartbeatId,
  heartbeatDisplayName,
  heartbeatFilePath,
  discoverHeartbeats,
  expandWorkspace,
} from "./discovery.ts";
import type { WorkspaceConfig } from "./types.ts";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "murmur-discovery-test-"));
}

describe("heartbeatId", () => {
  test("returns path for root heartbeat (no heartbeatFile)", () => {
    const ws: WorkspaceConfig = { path: "/repo", lastRun: null };
    expect(heartbeatId(ws)).toBe("/repo");
  });

  test("returns path for explicit HEARTBEAT.md", () => {
    const ws: WorkspaceConfig = { path: "/repo", heartbeatFile: "HEARTBEAT.md", lastRun: null };
    expect(heartbeatId(ws)).toBe("/repo");
  });

  test("returns compound id for named heartbeat", () => {
    const ws: WorkspaceConfig = {
      path: "/repo",
      heartbeatFile: "heartbeats/issue-worker/HEARTBEAT.md",
      lastRun: null,
    };
    expect(heartbeatId(ws)).toBe("/repo::heartbeats/issue-worker/HEARTBEAT.md");
  });
});

describe("heartbeatDisplayName", () => {
  test("returns basename for root heartbeat", () => {
    const ws: WorkspaceConfig = { path: "/home/user/my-project", lastRun: null };
    expect(heartbeatDisplayName(ws)).toBe("my-project");
  });

  test("returns compound name for named heartbeat", () => {
    const ws: WorkspaceConfig = {
      path: "/home/user/my-project",
      heartbeatFile: "heartbeats/issue-worker/HEARTBEAT.md",
      lastRun: null,
    };
    expect(heartbeatDisplayName(ws)).toBe("my-project/issue-worker");
  });

  test("returns basename for explicit HEARTBEAT.md", () => {
    const ws: WorkspaceConfig = {
      path: "/home/user/my-project",
      heartbeatFile: "HEARTBEAT.md",
      lastRun: null,
    };
    expect(heartbeatDisplayName(ws)).toBe("my-project");
  });
});

describe("heartbeatFilePath", () => {
  test("returns path/HEARTBEAT.md for root heartbeat", () => {
    const ws: WorkspaceConfig = { path: "/repo", lastRun: null };
    expect(heartbeatFilePath(ws)).toBe("/repo/HEARTBEAT.md");
  });

  test("returns path/heartbeatFile for named heartbeat", () => {
    const ws: WorkspaceConfig = {
      path: "/repo",
      heartbeatFile: "heartbeats/worker/HEARTBEAT.md",
      lastRun: null,
    };
    expect(heartbeatFilePath(ws)).toBe("/repo/heartbeats/worker/HEARTBEAT.md");
  });
});

describe("discoverHeartbeats", () => {
  test("finds root HEARTBEAT.md", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "HEARTBEAT.md"), "# Root");
    expect(discoverHeartbeats(dir)).toEqual(["HEARTBEAT.md"]);
  });

  test("finds heartbeats in heartbeats/ directory", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "heartbeats", "worker-a"), { recursive: true });
    mkdirSync(join(dir, "heartbeats", "worker-b"), { recursive: true });
    writeFileSync(join(dir, "heartbeats", "worker-a", "HEARTBEAT.md"), "# A");
    writeFileSync(join(dir, "heartbeats", "worker-b", "HEARTBEAT.md"), "# B");

    const found = discoverHeartbeats(dir);
    expect(found).toContain("heartbeats/worker-a/HEARTBEAT.md");
    expect(found).toContain("heartbeats/worker-b/HEARTBEAT.md");
    expect(found).toHaveLength(2);
  });

  test("finds both root and heartbeats/ entries", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "HEARTBEAT.md"), "# Root");
    mkdirSync(join(dir, "heartbeats", "monitor"), { recursive: true });
    writeFileSync(join(dir, "heartbeats", "monitor", "HEARTBEAT.md"), "# Monitor");

    const found = discoverHeartbeats(dir);
    expect(found).toContain("HEARTBEAT.md");
    expect(found).toContain("heartbeats/monitor/HEARTBEAT.md");
    expect(found).toHaveLength(2);
  });

  test("ignores heartbeats/ dirs without HEARTBEAT.md", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "heartbeats", "empty-dir"), { recursive: true });
    writeFileSync(join(dir, "heartbeats", "empty-dir", "notes.txt"), "not a heartbeat");

    expect(discoverHeartbeats(dir)).toEqual([]);
  });

  test("returns empty array for non-existent path", () => {
    expect(discoverHeartbeats("/nonexistent/path/abc123")).toEqual([]);
  });
});

describe("expandWorkspace", () => {
  test("returns ws unchanged for single root heartbeat", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "HEARTBEAT.md"), "# Root");
    const ws: WorkspaceConfig = { path: dir, lastRun: "2026-01-01T00:00:00Z" };

    const expanded = expandWorkspace(ws);
    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toBe(ws); // same reference — unchanged
  });

  test("expands multi-heartbeat workspace into separate entries", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "HEARTBEAT.md"), "# Root");
    mkdirSync(join(dir, "heartbeats", "worker"), { recursive: true });
    writeFileSync(join(dir, "heartbeats", "worker", "HEARTBEAT.md"), "# Worker");

    const ws: WorkspaceConfig = { path: dir, lastRun: "2026-01-01T00:00:00Z" };

    const expanded = expandWorkspace(ws);
    expect(expanded).toHaveLength(2);
    expect(expanded[0]!.heartbeatFile).toBe("HEARTBEAT.md");
    expect(expanded[1]!.heartbeatFile).toBe("heartbeats/worker/HEARTBEAT.md");
  });

  test("resolves lastRun from lastRuns map", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "HEARTBEAT.md"), "# Root");
    mkdirSync(join(dir, "heartbeats", "a"), { recursive: true });
    writeFileSync(join(dir, "heartbeats", "a", "HEARTBEAT.md"), "# A");

    const ws: WorkspaceConfig = {
      path: dir,
      lastRun: "2026-01-01T00:00:00Z",
      lastRuns: {
        "heartbeats/a/HEARTBEAT.md": "2026-02-01T00:00:00Z",
      },
    };

    const expanded = expandWorkspace(ws);
    expect(expanded).toHaveLength(2);
    // Root uses flat lastRun
    expect(expanded[0]!.lastRun).toBe("2026-01-01T00:00:00Z");
    // Named uses lastRuns map
    expect(expanded[1]!.lastRun).toBe("2026-02-01T00:00:00Z");
  });

  test("sets null lastRun for named heartbeat not in lastRuns map", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "heartbeats", "new"), { recursive: true });
    writeFileSync(join(dir, "heartbeats", "new", "HEARTBEAT.md"), "# New");

    const ws: WorkspaceConfig = { path: dir, lastRun: null };

    const expanded = expandWorkspace(ws);
    expect(expanded).toHaveLength(1);
    expect(expanded[0]!.lastRun).toBeNull();
  });
});
