import { describe, expect, test } from "bun:test";
import { parseFrontmatter, mergeWorkspaceConfig } from "./frontmatter.ts";
import type { WorkspaceConfig } from "./types.ts";

describe("parseFrontmatter", () => {
  test("parses valid frontmatter with strings and numbers", () => {
    const raw = `---
name: Issue Worker
description: Picks up triaged GitHub issues
interval: 30m
maxTurns: 50
---
# Heartbeat

Do the thing.`;

    const { metadata, content } = parseFrontmatter(raw);
    expect(metadata.name).toBe("Issue Worker");
    expect(metadata.description).toBe("Picks up triaged GitHub issues");
    expect(metadata.interval).toBe("30m");
    expect(metadata.maxTurns).toBe(50);
    expect(content).toBe("# Heartbeat\n\nDo the thing.");
  });

  test("returns empty metadata and full content when no frontmatter", () => {
    const raw = "# Heartbeat\n\nDo the thing.";
    const { metadata, content } = parseFrontmatter(raw);
    expect(metadata).toEqual({});
    expect(content).toBe(raw);
  });

  test("handles partial frontmatter", () => {
    const raw = `---
interval: 1h
---
Content here.`;
    const { metadata, content } = parseFrontmatter(raw);
    expect(metadata.interval).toBe("1h");
    expect(content).toBe("Content here.");
  });

  test("auto-detects integers but not interval strings", () => {
    const raw = `---
maxTurns: 50
timeout: 30m
port: 8080
---
Body`;
    const { metadata } = parseFrontmatter(raw);
    expect(metadata.maxTurns).toBe(50);
    expect(typeof metadata.maxTurns).toBe("number");
    expect(metadata.timeout).toBe("30m");
    expect(typeof metadata.timeout).toBe("string");
    expect(metadata.port).toBe(8080);
    expect(typeof metadata.port).toBe("number");
  });

  test("strips frontmatter from content", () => {
    const raw = `---
name: Test
---
# Title

Body text`;
    const { content } = parseFrontmatter(raw);
    expect(content).not.toContain("---");
    expect(content).not.toContain("name: Test");
    expect(content).toContain("# Title");
    expect(content).toContain("Body text");
  });

  test("skips comment lines in frontmatter", () => {
    const raw = `---
name: Test
# this is a comment
interval: 1h
---
Body`;
    const { metadata } = parseFrontmatter(raw);
    expect(metadata.name).toBe("Test");
    expect(metadata.interval).toBe("1h");
    expect(Object.keys(metadata)).toHaveLength(2);
  });

  test("skips blank lines in frontmatter", () => {
    const raw = `---
name: Test

interval: 1h
---
Body`;
    const { metadata } = parseFrontmatter(raw);
    expect(metadata.name).toBe("Test");
    expect(metadata.interval).toBe("1h");
  });
});

describe("mergeWorkspaceConfig", () => {
  const baseWs: WorkspaceConfig = {
    path: "/test",
    interval: "1h",
    lastRun: null,
  };

  test("frontmatter overrides config.json values", () => {
    const merged = mergeWorkspaceConfig(baseWs, {
      interval: "30m",
      name: "My Beat",
    });
    expect(merged.interval).toBe("30m");
    expect(merged.name).toBe("My Beat");
    expect(merged.path).toBe("/test");
  });

  test("config.json values used as fallback when no frontmatter", () => {
    const merged = mergeWorkspaceConfig(baseWs, {});
    expect(merged.interval).toBe("1h");
  });

  test("does not modify original config", () => {
    mergeWorkspaceConfig(baseWs, { interval: "30m" });
    expect(baseWs.interval).toBe("1h");
  });

  test("ignores unsupported keys", () => {
    const merged = mergeWorkspaceConfig(baseWs, { unknownKey: "value" } as any);
    expect((merged as any).unknownKey).toBeUndefined();
  });

  test("merges all supported keys", () => {
    const metadata = {
      name: "Test",
      description: "A test",
      interval: "15m",
      timeout: "10m",
      maxTurns: 25,
      agent: "pi",
      model: "opus",
      session: "my-session",
    };
    const merged = mergeWorkspaceConfig(baseWs, metadata);
    expect(merged.name).toBe("Test");
    expect(merged.description).toBe("A test");
    expect(merged.interval).toBe("15m");
    expect(merged.timeout).toBe("10m");
    expect(merged.maxTurns).toBe(25);
    expect(merged.agent).toBe("pi");
    expect(merged.model).toBe("opus");
    expect(merged.session).toBe("my-session");
  });

  test("only accepts numeric maxTurns, ignores string", () => {
    const merged = mergeWorkspaceConfig(baseWs, { maxTurns: "fifty" as any });
    expect(merged.maxTurns).toBeUndefined();
  });

  test("only accepts 'skip' for permissions", () => {
    const merged = mergeWorkspaceConfig(baseWs, { permissions: "skip" });
    expect(merged.permissions).toBe("skip");
  });

  test("ignores non-skip permissions values", () => {
    const merged = mergeWorkspaceConfig(baseWs, { permissions: "deny" } as any);
    expect(merged.permissions).toBeUndefined();
  });

  test("ignores numeric values for string fields", () => {
    const merged = mergeWorkspaceConfig(baseWs, { name: 123 as any });
    expect(merged.name).toBeUndefined();
  });
});
