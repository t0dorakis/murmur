import { describe, test, expect } from "bun:test";
import { mapKeyToAction } from "./keys.ts";

describe("mapKeyToAction", () => {
  test("q maps to quit", () => {
    expect(mapKeyToAction(Buffer.from("q"))).toBe("quit");
  });

  test("Ctrl+C maps to quit", () => {
    expect(mapKeyToAction(Buffer.from("\x03"))).toBe("quit");
  });

  test("Ctrl+D maps to detach", () => {
    expect(mapKeyToAction(Buffer.from("\x04"))).toBe("detach");
  });

  test("regular keys return null", () => {
    expect(mapKeyToAction(Buffer.from("a"))).toBeNull();
    expect(mapKeyToAction(Buffer.from("x"))).toBeNull();
    expect(mapKeyToAction(Buffer.from(" "))).toBeNull();
  });

  test("control characters return null", () => {
    expect(mapKeyToAction(Buffer.from("\x01"))).toBeNull(); // Ctrl+A
    expect(mapKeyToAction(Buffer.from("\x02"))).toBeNull(); // Ctrl+B
  });

  test("escape sequences return null", () => {
    expect(mapKeyToAction(Buffer.from("\x1b[A"))).toBeNull(); // Up arrow
    expect(mapKeyToAction(Buffer.from("\x1b[B"))).toBeNull(); // Down arrow
  });
});
