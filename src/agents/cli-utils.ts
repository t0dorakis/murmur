import { debug } from "../debug.ts";
import { wrapInLoginShell } from "./shell.ts";

/**
 * Check if a CLI command is available on the system.
 * Uses login shell to ensure full PATH is available.
 * @param command The command name (e.g., "claude", "pi", "aider")
 * @returns true if the command is found in PATH
 */
export async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    const wrappedCmd = wrapInLoginShell(["which", command]);
    const proc = Bun.spawn(wrappedCmd, {
      stdout: "pipe",
      stderr: "ignore",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch (err) {
    debug(
      `[cli-utils] isCommandAvailable('${command}') failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Get the version string of a CLI command.
 * Uses login shell to ensure full PATH is available.
 * @param command The command name
 * @param flag The version flag (default: "--version")
 * @returns Version string or null if unavailable
 */
export async function getCommandVersion(
  command: string,
  flag = "--version",
): Promise<string | null> {
  try {
    const wrappedCmd = wrapInLoginShell([command, flag]);
    const proc = Bun.spawn(wrappedCmd, {
      stdout: "pipe",
      stderr: "ignore",
    });
    const output = await new Response(proc.stdout).text();
    return output.trim() || null;
  } catch (err) {
    debug(
      `[cli-utils] getCommandVersion('${command}') failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
