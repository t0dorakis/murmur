import prettyMs from "pretty-ms";
import { truncate } from "./ansi.ts";

/**
 * Extract the most meaningful target from a tool call's input for display.
 */
export function formatToolTarget(input: Record<string, unknown>, maxLength = 60): string {
  if (input.file_path) return truncate(String(input.file_path), maxLength);
  if (input.command) return truncate(String(input.command), maxLength);
  if (input.pattern) return truncate(String(input.pattern), maxLength);
  if (input.path) return truncate(String(input.path), maxLength);
  if (input.query) return truncate(String(input.query), maxLength);
  if (input.url) return truncate(String(input.url), maxLength);
  const firstStr = Object.values(input).find((v) => typeof v === "string");
  return firstStr ? truncate(String(firstStr), maxLength) : "";
}

/**
 * Format tool duration for display. Returns null if duration is below threshold.
 */
export function formatToolDuration(
  durationMs: number | undefined,
  threshold = 1000,
): string | null {
  if (durationMs == null || durationMs <= threshold) return null;
  return `(${prettyMs(durationMs)})`;
}
