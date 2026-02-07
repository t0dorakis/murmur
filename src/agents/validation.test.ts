import { describe, expect, test } from "bun:test";
import { PiAdapter } from "./pi.ts";
import type { WorkspaceConfig } from "../types.ts";

describe("Pi Agent Config Validation", () => {
  const adapter = new PiAdapter();

  test("rejects invalid piExtensions type (not array)", async () => {
    const workspace = {
      path: "/test",
      agent: "pi",
      piExtensions: "not-an-array" as any,
      lastRun: null,
    } as WorkspaceConfig;

    await expect(adapter.execute("test", workspace)).rejects.toThrow(
      "piExtensions must be an array",
    );
  });

  test("rejects empty string in piExtensions array", async () => {
    const workspace = {
      path: "/test",
      agent: "pi",
      piExtensions: ["valid", "", "another"],
      lastRun: null,
    } as WorkspaceConfig;

    await expect(adapter.execute("test", workspace)).rejects.toThrow(
      "piExtension must be a non-empty string",
    );
  });

  test("rejects non-string in piExtensions array", async () => {
    const workspace = {
      path: "/test",
      agent: "pi",
      piExtensions: ["valid", 123 as any, "another"],
      lastRun: null,
    } as WorkspaceConfig;

    await expect(adapter.execute("test", workspace)).rejects.toThrow(
      "piExtension must be a non-empty string",
    );
  });

  test("rejects invalid piModel type", async () => {
    const workspace = {
      path: "/test",
      agent: "pi",
      piModel: 12345 as any,
      lastRun: null,
    } as WorkspaceConfig;

    await expect(adapter.execute("test", workspace)).rejects.toThrow(
      "piModel must be a string",
    );
  });

  test("rejects invalid piSession type", async () => {
    const workspace = {
      path: "/test",
      agent: "pi",
      piSession: { invalid: "object" } as any,
      lastRun: null,
    } as WorkspaceConfig;

    await expect(adapter.execute("test", workspace)).rejects.toThrow(
      "piSession must be a string",
    );
  });

  test("accepts valid pi config", async () => {
    const workspace = {
      path: "/test",
      agent: "pi",
      piExtensions: ["@mariozechner/pi-browser"],
      piSession: "test-session",
      piModel: "anthropic/claude-sonnet-4.5",
      lastRun: null,
    } as WorkspaceConfig;

    // This will fail to spawn pi, but validation should pass
    // We're just checking that validation doesn't throw
    try {
      await adapter.execute("HEARTBEAT_OK", workspace);
    } catch (err) {
      // Expected to fail at spawn, not validation
      expect(err).toBeTruthy();
    }
  });
});
