import { describe, test, expect } from "bun:test";
import { createTestScreen } from "./screen.ts";
import { styled, bold, green, dim } from "./ansi.ts";

describe("createTestScreen", () => {
  test("captures written content", () => {
    const screen = createTestScreen();
    screen.write("hello ");
    screen.write("world");
    expect(screen.buffer).toBe("hello world");
  });

  test("text() strips ANSI codes", () => {
    const screen = createTestScreen();
    screen.write(styled("hello", bold, green));
    expect(screen.text()).toBe("hello");
  });

  test("text() strips multiple ANSI sequences", () => {
    const screen = createTestScreen();
    screen.write(styled("a", bold) + " " + styled("b", dim, green));
    expect(screen.text()).toBe("a b");
  });

  test("lines() returns non-empty trimmed lines", () => {
    const screen = createTestScreen();
    screen.write("line1\n\n  \nline2\nline3\n");
    expect(screen.lines()).toEqual(["line1", "line2", "line3"]);
  });

  test("clear() resets buffer", () => {
    const screen = createTestScreen();
    screen.write("some content");
    screen.clear();
    expect(screen.buffer).toBe("");
    expect(screen.text()).toBe("");
  });

  test("returns configured dimensions", () => {
    const screen = createTestScreen(120, 40);
    expect(screen.columns()).toBe(120);
    expect(screen.rows()).toBe(40);
  });

  test("defaults to 80x24", () => {
    const screen = createTestScreen();
    expect(screen.columns()).toBe(80);
    expect(screen.rows()).toBe(24);
  });
});
