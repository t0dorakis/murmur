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

// Composites
export function styled(text: string, ...codes: string[]): string {
  if (codes.length === 0) return text;
  return codes.join("") + text + reset;
}

export function terminalWidth(): number {
  return process.stdout.columns ?? 80;
}

export function truncate(text: string, maxWidth: number, suffix = "…"): string {
  if (text.length <= maxWidth) return text;
  return text.slice(0, maxWidth - suffix.length) + suffix;
}

export function padRight(text: string, width: number): string {
  if (text.length >= width) return text;
  return text + " ".repeat(width - text.length);
}

export function write(content: string): void {
  try {
    process.stdout.write(content);
  } catch {
    // stdout gone (pipe closed, terminal detached)
  }
}
