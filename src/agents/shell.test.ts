import { describe, expect, test, afterEach } from "bun:test";
import { wrapInLoginShell } from "./shell.ts";

describe("wrapInLoginShell", () => {
  const originalPlatform = process.platform;
  const originalShell = process.env.SHELL;

  afterEach(() => {
    // Restore original values
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
    if (originalShell) {
      process.env.SHELL = originalShell;
    } else {
      delete process.env.SHELL;
    }
  });

  test("wraps command in login shell on Unix (macOS)", () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
      configurable: true,
    });
    process.env.SHELL = "/bin/zsh";

    const result = wrapInLoginShell(["claude", "--version"]);
    expect(result).toEqual(["/bin/zsh", "-lc", "'claude' '--version'"]);
  });

  test("wraps command in login shell on Unix (Linux)", () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      writable: true,
      configurable: true,
    });
    process.env.SHELL = "/bin/bash";

    const result = wrapInLoginShell(["pi", "--help"]);
    expect(result).toEqual(["/bin/bash", "-lc", "'pi' '--help'"]);
  });

  test("returns original command on Windows", () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      writable: true,
      configurable: true,
    });

    const result = wrapInLoginShell(["claude", "--version"]);
    expect(result).toEqual(["claude", "--version"]);
  });

  test("falls back to /bin/sh when SHELL is not set", () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
      configurable: true,
    });
    delete process.env.SHELL;

    const result = wrapInLoginShell(["codex", "exec"]);
    expect(result).toEqual(["/bin/sh", "-lc", "'codex' 'exec'"]);
  });

  test("handles empty command array", () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
      configurable: true,
    });
    process.env.SHELL = "/bin/zsh";

    const result = wrapInLoginShell([]);
    expect(result).toEqual([]);
  });

  test("escapes single quotes in arguments", () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
      configurable: true,
    });
    process.env.SHELL = "/bin/bash";

    const result = wrapInLoginShell(["echo", "it's working"]);
    expect(result).toEqual(["/bin/bash", "-lc", "'echo' 'it'\\''s working'"]);
  });

  test("handles arguments with spaces", () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
      configurable: true,
    });
    process.env.SHELL = "/bin/zsh";

    const result = wrapInLoginShell(["claude", "--prompt", "hello world"]);
    expect(result).toEqual(["/bin/zsh", "-lc", "'claude' '--prompt' 'hello world'"]);
  });

  test("handles arguments with special characters", () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
      configurable: true,
    });
    process.env.SHELL = "/bin/bash";

    const result = wrapInLoginShell(["echo", "$HOME", "$(pwd)", "`ls`"]);
    expect(result).toEqual(["/bin/bash", "-lc", "'echo' '$HOME' '$(pwd)' '`ls`'"]);
  });

  test("handles complex multi-arg commands", () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      writable: true,
      configurable: true,
    });
    process.env.SHELL = "/bin/bash";

    const result = wrapInLoginShell([
      "codex",
      "exec",
      "--sandbox",
      "workspace-write",
      "--model",
      "o1",
      "-",
    ]);
    expect(result).toEqual([
      "/bin/bash",
      "-lc",
      "'codex' 'exec' '--sandbox' 'workspace-write' '--model' 'o1' '-'",
    ]);
  });
});
