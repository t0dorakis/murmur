import { describe, expect, test } from "bun:test";
import {
  DEFAULT_DENY_LIST,
  buildDenyList,
  buildDisallowedToolsArgs,
  validatePermissions,
} from "./permissions.ts";

describe("DEFAULT_DENY_LIST", () => {
  test("contains filesystem destruction patterns", () => {
    expect(DEFAULT_DENY_LIST).toContain("Bash(rm -rf /)");
    expect(DEFAULT_DENY_LIST).toContain("Bash(rm -rf /*)");
    expect(DEFAULT_DENY_LIST).toContain("Bash(rm -rf ~)");
    expect(DEFAULT_DENY_LIST).toContain("Bash(rm -rf ~/*)");
  });

  test("contains privilege escalation pattern", () => {
    expect(DEFAULT_DENY_LIST).toContain("Bash(sudo )");
  });

  test("contains system control patterns", () => {
    expect(DEFAULT_DENY_LIST).toContain("Bash(shutdown )");
    expect(DEFAULT_DENY_LIST).toContain("Bash(reboot)");
    expect(DEFAULT_DENY_LIST).toContain("Bash(halt)");
    expect(DEFAULT_DENY_LIST).toContain("Bash(poweroff)");
  });

  test("contains disk formatting and raw write patterns", () => {
    expect(DEFAULT_DENY_LIST).toContain("Bash(mkfs)");
    expect(DEFAULT_DENY_LIST).toContain("Bash(dd if=)");
    expect(DEFAULT_DENY_LIST).toContain("Bash(shred )");
  });
});

describe("buildDenyList", () => {
  test("returns defaults when no permissions provided", () => {
    const result = buildDenyList();
    expect(result).toEqual([...DEFAULT_DENY_LIST]);
  });

  test("returns defaults when permissions has no deny field", () => {
    const result = buildDenyList({});
    expect(result).toEqual([...DEFAULT_DENY_LIST]);
  });

  test("returns defaults when deny is empty", () => {
    const result = buildDenyList({ deny: [] });
    expect(result).toEqual([...DEFAULT_DENY_LIST]);
  });

  test("merges workspace deny rules with defaults", () => {
    const result = buildDenyList({ deny: ["Bash(curl )", "Bash(wget )"] });
    expect(result).toContain("Bash(curl )");
    expect(result).toContain("Bash(wget )");
    // Defaults still present
    expect(result).toContain("Bash(sudo )");
    expect(result).toContain("Bash(rm -rf /)");
  });

  test("deduplicates rules already in defaults", () => {
    const result = buildDenyList({ deny: ["Bash(sudo )"] });
    const sudoCount = result.filter((r) => r === "Bash(sudo )").length;
    expect(sudoCount).toBe(1);
  });

  test("preserves order: defaults first, then workspace rules", () => {
    const result = buildDenyList({ deny: ["Bash(curl )"] });
    const sudoIdx = result.indexOf("Bash(sudo )");
    const curlIdx = result.indexOf("Bash(curl )");
    expect(sudoIdx).toBeLessThan(curlIdx);
  });
});

describe("buildDisallowedToolsArgs", () => {
  test("returns --disallowedTools followed by all deny rules", () => {
    const result = buildDisallowedToolsArgs();
    expect(result[0]).toBe("--disallowedTools");
    expect(result.length).toBe(1 + DEFAULT_DENY_LIST.length);
    // All default rules present as individual args
    for (const rule of DEFAULT_DENY_LIST) {
      expect(result).toContain(rule);
    }
  });

  test("includes workspace-specific deny rules", () => {
    const result = buildDisallowedToolsArgs({ deny: ["Bash(curl )"] });
    expect(result).toContain("--disallowedTools");
    expect(result).toContain("Bash(curl )");
    expect(result).toContain("Bash(sudo )");
  });
});

describe("validatePermissions", () => {
  test("accepts undefined", () => {
    expect(validatePermissions(undefined)).toBeNull();
  });

  test("accepts null", () => {
    expect(validatePermissions(null)).toBeNull();
  });

  test("accepts empty object", () => {
    expect(validatePermissions({})).toBeNull();
  });

  test("accepts valid deny array", () => {
    expect(validatePermissions({ deny: ["Bash(curl )"] })).toBeNull();
  });

  test("accepts empty deny array", () => {
    expect(validatePermissions({ deny: [] })).toBeNull();
  });

  test("rejects non-object permissions", () => {
    expect(validatePermissions("string")).toContain("must be an object");
    expect(validatePermissions(42)).toContain("must be an object");
    expect(validatePermissions([])).toContain("must be an object");
  });

  test("rejects non-array deny", () => {
    expect(validatePermissions({ deny: "string" })).toContain("must be an array");
    expect(validatePermissions({ deny: 42 })).toContain("must be an array");
  });

  test("rejects non-string items in deny", () => {
    expect(validatePermissions({ deny: [42] })).toContain("must be a string");
    expect(validatePermissions({ deny: ["valid", null] })).toContain("must be a string");
  });

  test("rejects empty string in deny", () => {
    expect(validatePermissions({ deny: [""] })).toContain("must not be empty");
  });
});
