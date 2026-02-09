import { YAML } from "bun";
import { readFileSync } from "node:fs";
import { debug } from "./debug.ts";
import { heartbeatDisplayName, heartbeatFilePath } from "./discovery.ts";
import type { WorkspaceConfig } from "./types.ts";

export type FrontmatterResult = {
  metadata: Record<string, unknown>;
  content: string;
};

/**
 * Parse YAML frontmatter from a markdown string.
 * Uses Bun's built-in YAML parser for full spec compliance.
 */
export function parseFrontmatter(raw: string): FrontmatterResult {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { metadata: {}, content: raw };

  const parsed = YAML.parse(match[1]!);
  const metadata: Record<string, unknown> =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};

  return { metadata, content: match[2]! };
}

/** String fields that map directly from frontmatter to WorkspaceConfig. */
const STRING_FIELDS = [
  "name",
  "description",
  "interval",
  "cron",
  "tz",
  "timeout",
  "agent",
  "model",
  "session",
  "sandbox",
] as const;

/**
 * Merge frontmatter metadata into a workspace config.
 * Frontmatter values take precedence over config.json values.
 * Only `permissions: skip` is supported in frontmatter (deny lists require config.json).
 */
export function mergeWorkspaceConfig(
  ws: WorkspaceConfig,
  metadata: Record<string, unknown>,
): WorkspaceConfig {
  const merged = { ...ws };

  for (const field of STRING_FIELDS) {
    const val = metadata[field];
    if (typeof val === "string") (merged as any)[field] = val;
  }

  if (typeof metadata.maxTurns === "number") merged.maxTurns = metadata.maxTurns;
  if (typeof metadata.networkAccess === "boolean")
    (merged as any).networkAccess = metadata.networkAccess;
  if (metadata.permissions === "skip") merged.permissions = "skip";

  return merged;
}

/**
 * Read HEARTBEAT.md, parse frontmatter, and merge with config.json workspace entry.
 * Also extracts workspace name from the first markdown heading as fallback.
 */
export function resolveWorkspaceConfig(ws: WorkspaceConfig): WorkspaceConfig {
  const filePath = heartbeatFilePath(ws);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT" && ws.heartbeatFile) {
      debug(`Warning: ${filePath} was discovered but no longer exists`);
    } else if (err?.code !== "ENOENT") {
      debug(`Warning: could not read ${filePath}: ${err?.message}`);
    }
    return ws;
  }

  let metadata: Record<string, unknown>;
  let content: string;
  try {
    ({ metadata, content } = parseFrontmatter(raw));
  } catch (err: any) {
    debug(`Warning: could not parse frontmatter in ${filePath}: ${err?.message}`);
    return ws;
  }
  const resolved = mergeWorkspaceConfig(ws, metadata);

  // Extract name from first heading if not set in frontmatter
  if (!resolved.name) {
    const headingMatch = /^#\s+(.+)/m.exec(content) ?? /^#\s+(.+)/m.exec(raw);
    if (headingMatch) {
      resolved.name = headingMatch[1]!.trim();
    } else {
      resolved.name = heartbeatDisplayName(ws);
    }
  }

  return resolved;
}
