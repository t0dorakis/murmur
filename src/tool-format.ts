import type { ToolCall } from "./types.ts";

/**
 * Extract the most meaningful target from a tool call's input for display.
 */
export function formatToolTarget(input: Record<string, unknown>, maxLength = 60): string {
  if (input.file_path) return String(input.file_path);
  if (input.command) return String(input.command).slice(0, maxLength);
  if (input.pattern) return String(input.pattern);
  if (input.path) return String(input.path);
  if (input.query) return String(input.query).slice(0, maxLength);
  if (input.url) return String(input.url).slice(0, maxLength);
  const firstStr = Object.values(input).find((v) => typeof v === "string");
  return firstStr ? String(firstStr).slice(0, maxLength) : "";
}

/**
 * Format tool duration for display. Returns null if duration is below threshold.
 */
export function formatToolDuration(durationMs: number | undefined, threshold = 1000): string | null {
  if (durationMs == null || durationMs <= threshold) return null;
  return `(${(durationMs / 1000).toFixed(1)}s)`;
}
