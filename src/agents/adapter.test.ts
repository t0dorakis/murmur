import { describe, expect, test } from "bun:test";
import {
  getAdapter,
  listAdapters,
  detectAvailableAgents,
} from "./index.ts";

describe("Agent Adapter Registry", () => {
  test("lists registered adapters", () => {
    const adapters = listAdapters();
    expect(adapters).toContain("claude-code");
    expect(adapters).toContain("pi");
  });

  test("gets claude-code adapter", () => {
    const adapter = getAdapter("claude-code");
    expect(adapter.name).toBe("claude-code");
  });

  test("gets pi adapter", () => {
    const adapter = getAdapter("pi");
    expect(adapter.name).toBe("pi");
  });

  test("throws error for unknown adapter", () => {
    expect(() => getAdapter("nonexistent")).toThrow();
  });

  test("detectAvailableAgents returns array", async () => {
    const available = await detectAvailableAgents();
    expect(Array.isArray(available)).toBe(true);
    // At least Claude Code should be available in most test environments
    // but we don't enforce this since it depends on system setup
  });
});

describe("Agent Adapter Interface", () => {
  test("claude-code adapter has required methods", () => {
    const adapter = getAdapter("claude-code");
    expect(typeof adapter.execute).toBe("function");
    expect(typeof adapter.isAvailable).toBe("function");
    expect(typeof adapter.getVersion).toBe("function");
  });

  test("pi adapter has required methods", () => {
    const adapter = getAdapter("pi");
    expect(typeof adapter.execute).toBe("function");
    expect(typeof adapter.isAvailable).toBe("function");
    expect(typeof adapter.getVersion).toBe("function");
  });

  test("adapter.isAvailable returns boolean", async () => {
    const adapter = getAdapter("claude-code");
    const available = await adapter.isAvailable();
    expect(typeof available).toBe("boolean");
  });

  test("adapter.getVersion returns string or null", async () => {
    const adapter = getAdapter("claude-code");
    const version = await adapter.getVersion();
    expect(version === null || typeof version === "string").toBe(true);
  });
});
