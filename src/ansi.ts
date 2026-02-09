const ESC = "\x1b[";

// Screen
export const altScreenOn = `${ESC}?1049h`;
export const altScreenOff = `${ESC}?1049l`;
export const cursorHide = `${ESC}?25l`;
export const cursorShow = `${ESC}?25h`;
export const cursorHome = `${ESC}H`;
export const clearLine = `${ESC}2K`;
export const clearToEnd = `${ESC}J`;

// Text attributes
const reset = `${ESC}0m`;
export const bold = `${ESC}1m`;
export const dim = `${ESC}2m`;

// Colors
export const green = `${ESC}32m`;
export const yellow = `${ESC}33m`;
export const red = `${ESC}31m`;
export const white = `${ESC}37m`;
export const cyan = `${ESC}36m`;

// Tool icons for verbose display
export const toolIcons = {
  pending: "◇", // Tool started, waiting for result
  complete: "◆", // Tool completed successfully
  running: "⟳", // Tool currently running
  error: "✗", // Tool failed
} as const;

// General-purpose status icons
export const icons = {
  ok: "✓",
  fail: "✗",
  bullet: "•",
} as const;

// Composites
export function styled(text: string, ...codes: string[]): string {
  if (codes.length === 0) return text;
  return codes.join("") + text + reset;
}

/** Matches all CSI escape sequences (colors, cursor movement, clear, etc.). */
export const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

/** Strip ANSI escape sequences, returning only visible characters. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** Visible character count, ignoring ANSI escape sequences. */
export function visualWidth(text: string): number {
  return stripAnsi(text).length;
}

export function truncate(text: string, maxWidth: number, suffix = "…"): string {
  const stripped = stripAnsi(text);
  if (stripped.length <= maxWidth) return text;
  // Walk the original string, counting only visible characters
  let visible = 0;
  let i = 0;
  const target = maxWidth - suffix.length;
  while (i < text.length && visible < target) {
    const match = text.slice(i).match(/^\x1b\[[0-9;]*[A-Za-z]/);
    if (match) {
      i += match[0].length;
    } else {
      i++;
      visible++;
    }
  }
  return text.slice(0, i) + reset + suffix;
}

export function padRight(text: string, width: number): string {
  const w = visualWidth(text);
  if (w >= width) return text;
  return text + " ".repeat(width - w);
}
