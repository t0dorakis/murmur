import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { classify, buildPrompt } from "./heartbeat.ts";

describe("classify", () => {
  test("returns error when exit code is non-zero", () => {
    expect(classify("some output", 1)).toBe("error");
    expect(classify("HEARTBEAT_OK", 1)).toBe("error");
  });

  test("returns ok when stdout contains HEARTBEAT_OK", () => {
    expect(classify("HEARTBEAT_OK", 0)).toBe("ok");
    expect(classify("  HEARTBEAT_OK  ", 0)).toBe("ok");
    expect(classify("Some prefix HEARTBEAT_OK", 0)).toBe("ok");
  });

  test("returns attention for other output", () => {
    expect(classify("ATTENTION: 2 tests failing", 0)).toBe("attention");
    expect(classify("Something needs your attention", 0)).toBe("attention");
    expect(classify("", 0)).toBe("attention");
  });
});

describe("buildPrompt", () => {
  test("strips frontmatter from prompt content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "murmur-test-"));
    const heartbeat = `---
name: Test Beat
interval: 30m
---
# Heartbeat

Do the thing.`;
    await Bun.write(join(dir, "HEARTBEAT.md"), heartbeat);

    const prompt = await buildPrompt({ path: dir, lastRun: null });

    // Frontmatter should be stripped
    expect(prompt).not.toContain("name: Test Beat");
    expect(prompt).not.toContain("interval: 30m");
    // Content should be present
    expect(prompt).toContain("# Heartbeat");
    expect(prompt).toContain("Do the thing.");
  });

  test("works with HEARTBEAT.md without frontmatter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "murmur-test-"));
    const heartbeat = "# Heartbeat\n\nDo the thing.";
    await Bun.write(join(dir, "HEARTBEAT.md"), heartbeat);

    const prompt = await buildPrompt({ path: dir, lastRun: null });
    expect(prompt).toContain("# Heartbeat");
    expect(prompt).toContain("Do the thing.");
  });

  test("reads from heartbeatFile when specified", async () => {
    const dir = mkdtempSync(join(tmpdir(), "murmur-test-"));
    mkdirSync(join(dir, "heartbeats", "worker"), { recursive: true });
    await Bun.write(join(dir, "heartbeats", "worker", "HEARTBEAT.md"), "# Worker\n\nDo work.");

    const prompt = await buildPrompt({
      path: dir,
      heartbeatFile: "heartbeats/worker/HEARTBEAT.md",
      lastRun: null,
    });
    // CWD should still be the repo root
    expect(prompt).toContain(`WORKSPACE: ${dir}`);
    expect(prompt).toContain("# Worker");
    expect(prompt).toContain("Do work.");
  });
});
