import { stripAnsi } from "./ansi.ts";

export type Screen = {
  write(content: string): void;
  columns(): number;
  rows(): number;
};

export function createScreen(): Screen {
  return {
    write(content: string) {
      try {
        process.stdout.write(content);
      } catch {
        // stdout gone (pipe closed, terminal detached)
      }
    },
    columns() {
      return process.stdout.columns ?? 80;
    },
    rows() {
      return process.stdout.rows ?? 24;
    },
  };
}

export type TestScreen = Screen & {
  buffer: string;
  clear(): void;
  text(): string;
  lines(): string[];
};

export function createTestScreen(cols = 80, rows = 24): TestScreen {
  let buffer = "";
  return {
    write(content: string) {
      buffer += content;
    },
    columns: () => cols,
    rows: () => rows,
    get buffer() {
      return buffer;
    },
    clear() {
      buffer = "";
    },
    text() {
      return stripAnsi(buffer);
    },
    lines() {
      return this.text()
        .split("\n")
        .filter((l) => l.trim().length > 0);
    },
  };
}
