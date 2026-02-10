import { debug } from "../debug.ts";

/**
 * Escape a shell argument for safe use in a shell command string.
 * Wraps the argument in single quotes and escapes any single quotes within it.
 *
 * @param arg The argument to escape
 * @returns Escaped argument safe for shell execution
 */
function escapeShellArg(arg: string): string {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Check if we should use login shell wrapping based on the platform.
 * Login shell is only used on Unix-like systems (macOS, Linux).
 *
 * @returns true if login shell should be used
 */
function shouldUseLoginShell(): boolean {
  const platform = process.platform;
  return platform !== "win32";
}

/**
 * Get the user's login shell from environment, with fallback.
 *
 * @returns Path to the shell executable
 */
function getLoginShell(): string {
  return process.env.SHELL || "/bin/sh";
}

/**
 * Wrap a command array for execution through a login shell.
 * On Unix-like systems (macOS, Linux), spawns through `$SHELL -lc "command args..."`.
 * On Windows or when $SHELL is not set, returns the original command array.
 *
 * This ensures the spawned process inherits the user's full environment (PATH, etc.)
 * including modifications from .bash_profile, .zshrc, etc.
 *
 * @param command Command array (e.g., ["claude", "--version"])
 * @returns Wrapped command array for Bun.spawn
 *
 * @example
 * ```ts
 * // On macOS/Linux with $SHELL=/bin/zsh:
 * wrapInLoginShell(["claude", "--version"])
 * // Returns: ["/bin/zsh", "-lc", "'claude' '--version'"]
 *
 * // On Windows:
 * wrapInLoginShell(["claude", "--version"])
 * // Returns: ["claude", "--version"]
 * ```
 */
export function wrapInLoginShell(command: string[]): string[] {
  if (!shouldUseLoginShell() || command.length === 0) {
    return command;
  }

  const shell = getLoginShell();
  const escapedArgs = command.map(escapeShellArg);
  const commandString = escapedArgs.join(" ");

  debug(`[shell] Wrapping command in login shell: ${shell} -lc ${commandString}`);

  return [shell, "-lc", commandString];
}
