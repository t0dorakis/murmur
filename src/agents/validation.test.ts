import { describe, expect, test } from "bun:test";
import { PiAdapter } from "./pi.ts";
import type { WorkspaceConfig } from "../types.ts";

describe("Pi Agent Config Validation", () => {
  const adapter = new PiAdapter();

  test("rejects invalid model type", async () => {
    const workspace = {
      path: "/test",
      agent: "pi",
      model: 12345 as any,
      lastRun: null,
    } as WorkspaceConfig;

    await expect(adapter.execute("test", workspace)).rejects.toThrow("model must be a string");
  });

  test("rejects invalid session type", async () => {
    const workspace = {
      path: "/test",
      agent: "pi",
      session: { invalid: "object" } as any,
      lastRun: null,
    } as WorkspaceConfig;

    await expect(adapter.execute("test", workspace)).rejects.toThrow("session must be a string");
  });

  test("accepts valid pi config", async () => {
    const workspace = {
      path: "/test",
      agent: "pi",
      session: "test-session",
      model: "anthropic/claude-sonnet-4.5",
      lastRun: null,
    } as WorkspaceConfig;

    // This will fail to spawn pi (command likely not available), but validation should pass
    try {
      await adapter.execute("HEARTBEAT_OK", workspace);
    } catch (err) {
      // Should fail at spawn (ENOENT, command not found), not at validation
      const errorMsg = err instanceof Error ? err.message : String(err);
      expect(errorMsg).toMatch(/spawn|ENOENT|command not found|pi/i);
      expect(errorMsg).not.toMatch(/must be a string/);
    }
  });
});
