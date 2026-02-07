import type { WorkspaceConfig } from "./types.ts";

export type FrontmatterResult = {
  metadata: Record<string, string | number>;
  content: string;
};

/**
 * Parse YAML frontmatter from a markdown string.
 * Supports simple key: value pairs. Auto-detects numbers.
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

    // Auto-detect numbers (integers only — intervals like "30m" stay strings)
    const num = Number(value);
    metadata[key] = Number.isFinite(num) && String(num) === value ? num : value;
  }

  return { metadata, content };
}

/** Frontmatter keys that map to WorkspaceConfig fields. */
const SUPPORTED_KEYS = new Set([
  "name",
  "description",
  "interval",
  "cron",
  "tz",
  "timeout",
  "maxTurns",
  "agent",
  "model",
  "session",
  "permissions",
]);

/**
 * Merge frontmatter metadata into a workspace config.
 * Frontmatter values take precedence over config.json values.
 */
export function mergeWorkspaceConfig(
  ws: WorkspaceConfig,
  metadata: Record<string, string | number>,
): WorkspaceConfig {
  const merged = { ...ws };

  for (const [key, value] of Object.entries(metadata)) {
    if (!SUPPORTED_KEYS.has(key)) continue;
    (merged as any)[key] = value;
  }

  return merged;
}
