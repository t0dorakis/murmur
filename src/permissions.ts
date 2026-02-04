import type { PermissionsConfig } from "./types.ts";

/**
 * Default deny list for heartbeat agents.
 *
 * These patterns are always blocked unless explicitly overridden.
 * Claude Code's --disallowedTools uses prefix matching on Bash commands,
 * so "Bash(rm -rf /)" blocks any command starting with "rm -rf /".
 */
export const DEFAULT_DENY_LIST: readonly string[] = [
  // Filesystem destruction
  "Bash(rm -rf /)",
  "Bash(rm -rf /*)",
  "Bash(rm -rf ~)",
  "Bash(rm -rf ~/*)",

  // Disk formatting
  "Bash(mkfs)",

  // Raw disk writes
  "Bash(dd if=)",

  // Secure deletion
  "Bash(shred )",

  // Privilege escalation
  "Bash(sudo )",

  // System control
  "Bash(shutdown )",
  "Bash(reboot)",
  "Bash(halt)",
  "Bash(poweroff)",
];

/**
 * Merge default deny list with workspace-specific deny rules.
 * Workspace deny rules are appended to the defaults (union).
 */
export function buildDenyList(permissions?: PermissionsConfig): string[] {
  const merged = [...DEFAULT_DENY_LIST];

  if (permissions?.deny) {
    for (const rule of permissions.deny) {
      if (!merged.includes(rule)) {
        merged.push(rule);
      }
    }
  }

  return merged;
}

/**
 * Build --disallowedTools CLI arguments from a deny list.
 * Returns an array like: ["--disallowedTools", "Bash(sudo )", "Bash(rm -rf /)", ...]
 */
export function buildDisallowedToolsArgs(permissions?: PermissionsConfig): string[] {
  const denyList = buildDenyList(permissions);
  if (denyList.length === 0) return [];
  return ["--disallowedTools", ...denyList];
}

/**
 * Validate a permissions config object.
 * Returns an error message if invalid, or null if valid.
 */
export function validatePermissions(permissions: unknown): string | null {
  if (permissions === undefined || permissions === null) return null;

  if (typeof permissions !== "object" || Array.isArray(permissions)) {
    return `"permissions" must be an object`;
  }

  const perms = permissions as Record<string, unknown>;

  if (perms.deny !== undefined) {
    if (!Array.isArray(perms.deny)) {
      return `"permissions.deny" must be an array of strings`;
    }
    for (let i = 0; i < perms.deny.length; i++) {
      if (typeof perms.deny[i] !== "string") {
        return `"permissions.deny[${i}]" must be a string`;
      }
      if ((perms.deny[i] as string).length === 0) {
        return `"permissions.deny[${i}]" must not be empty`;
      }
    }
  }

  return null;
}
