import { debug } from "../debug.ts";

/**
 * Check if a CLI command is available on the system.
 * @param command The command name (e.g., "claude", "pi", "aider")
 * @returns true if the command is found in PATH
 */
export async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", command], {
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
 * @param command The command name
 * @param flag The version flag (default: "--version")
 * @returns Version string or null if unavailable
 */
export async function getCommandVersion(
  command: string,
  flag = "--version",
): Promise<string | null> {
  try {
    const proc = Bun.spawn([command, flag], {
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
