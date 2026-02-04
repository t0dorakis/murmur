import { createEventBus, type EventSource } from "./events.ts";
import type { DaemonEvent } from "./types.ts";

export type SocketConnection = EventSource & { close(): void };

export async function connectToSocket(socketPath: string): Promise<SocketConnection> {
  const bus = createEventBus();
  let buffer = "";
  let connected = false;

  return new Promise((resolve, reject) => {
    Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) {
          connected = true;
          resolve({
            subscribe: bus.subscribe,
            unsubscribe: bus.unsubscribe,
            close() {
              socket.end();
            },
          });
        },
        data(_socket, raw) {
          buffer += typeof raw === "string" ? raw : new TextDecoder().decode(raw);
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            let event: DaemonEvent;
            try {
              const parsed = JSON.parse(line);
              if (!parsed || typeof parsed.type !== "string") continue;
              event = parsed as DaemonEvent;
            } catch {
              continue;
            }
            bus.emit(event);
          }
        },
        close() {
          bus.emit({ type: "daemon:shutdown" });
        },
        error(_socket, err) {
          if (connected) {
            console.error(`Socket error: ${err.message}`);
          } else {
            reject(new Error(`Connection failed: ${err.message}`));
          }
        },
      },
    });
  });
}
