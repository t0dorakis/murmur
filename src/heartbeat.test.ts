import { describe, expect, test } from "bun:test";
import { classify } from "./heartbeat.ts";

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
