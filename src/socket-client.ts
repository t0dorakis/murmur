import type { EventSource } from "./tui.ts";
import type { DaemonEvent } from "./types.ts";

export async function connectToSocket(socketPath: string): Promise<EventSource & { close(): void }> {
  type Callback = (event: DaemonEvent) => void;
  const listeners: Callback[] = [];
  let buffer = "";
  let sock: ReturnType<typeof Bun.connect> extends Promise<infer T> ? T : never;

  return new Promise((resolve, reject) => {
    Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) {
          sock = socket;
          resolve({
            subscribe(cb: Callback) {
              listeners.push(cb);
            },
            unsubscribe(cb: Callback) {
              const idx = listeners.indexOf(cb);
              if (idx !== -1) listeners.splice(idx, 1);
            },
            close() {
              sock.end();
            },
          });
        },
        data(_socket, raw) {
          buffer += typeof raw === "string" ? raw : new TextDecoder().decode(raw);
          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line) as DaemonEvent;
              for (const cb of listeners) cb(event);
            } catch {
              // Skip malformed lines
            }
          }
        },
        close() {
          const shutdown: DaemonEvent = { type: "daemon:shutdown" };
          for (const cb of listeners) cb(shutdown);
        },
        error(_socket, err) {
          reject(new Error(`Connection failed: ${err.message}`));
        },
      },
    });
  });
}
