import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { debug } from "./debug.ts";
import type { WorkspaceConfig } from "./types.ts";

export type FrontmatterResult = {
  metadata: Record<string, string | number>;
  content: string;
};

/**
 * Parse YAML frontmatter from a markdown string.
 * Supports simple key: value pairs. Auto-detects numeric literals.
 */
export function parseFrontmatter(raw: string): FrontmatterResult {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { metadata: {}, content: raw };

  const yamlBlock = match[1]!;
  const content = match[2]!;
  const metadata: Record<string, string | number> = {};

  for (const line of yamlBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (!key || !value) continue;

    // Auto-detect numeric literals — intervals like "30m" stay strings
    const num = Number(value);
    metadata[key] = Number.isFinite(num) && String(num) === value ? num : value;
  }

  return { metadata, content };
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
] as const;

/**
 * Merge frontmatter metadata into a workspace config.
 * Frontmatter values take precedence over config.json values.
 * Only `permissions: skip` is supported in frontmatter (deny lists require config.json).
 */
export function mergeWorkspaceConfig(
  ws: WorkspaceConfig,
  metadata: Record<string, string | number>,
): WorkspaceConfig {
  const merged = { ...ws };

  for (const field of STRING_FIELDS) {
    const val = metadata[field];
    if (typeof val === "string") (merged as any)[field] = val;
  }

  if (typeof metadata.maxTurns === "number") merged.maxTurns = metadata.maxTurns;
  if (metadata.permissions === "skip") merged.permissions = "skip";

  return merged;
}

/**
 * Read HEARTBEAT.md, parse frontmatter, and merge with config.json workspace entry.
 * Also extracts workspace name from the first markdown heading as fallback.
 */
export function resolveWorkspaceConfig(ws: WorkspaceConfig): WorkspaceConfig {
  let raw: string;
  try {
    raw = readFileSync(join(ws.path, "HEARTBEAT.md"), "utf-8");
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      debug(`Warning: could not read HEARTBEAT.md in ${ws.path}: ${err?.message}`);
    }
    return ws;
  }

  const { metadata, content } = parseFrontmatter(raw);
  const resolved = mergeWorkspaceConfig(ws, metadata);

  // Extract name from first heading if not set in frontmatter
  if (!resolved.name) {
    const headingMatch = /^#\s+(.+)/m.exec(content) ?? /^#\s+(.+)/m.exec(raw);
    if (headingMatch) {
      resolved.name = headingMatch[1]!.trim();
    } else {
      resolved.name = basename(ws.path);
    }
  }

  return resolved;
}
