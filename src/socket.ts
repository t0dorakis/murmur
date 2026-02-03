import type { EventBus } from "./events.ts";
import type { DaemonEvent } from "./types.ts";

export type SocketServer = {
  stop(): void;
};

export function startSocketServer(bus: EventBus, socketPath: string, workspaceCount: number): SocketServer {
  const clients = new Set<{ write(data: string): void }>();
  let lastTickEvent: DaemonEvent | null = null;

  function broadcast(event: DaemonEvent) {
    if (event.type === "tick") lastTickEvent = event;
    const line = JSON.stringify(event) + "\n";
    for (const client of clients) {
      try {
        client.write(line);
      } catch {
        clients.delete(client);
      }
    }
  }

  bus.subscribe(broadcast);

  const server = Bun.listen({
    unix: socketPath,
    socket: {
      open(socket) {
        clients.add(socket);
        const ready: DaemonEvent = { type: "daemon:ready", pid: process.pid, workspaceCount };
        try {
          socket.write(JSON.stringify(ready) + "\n");
          if (lastTickEvent) socket.write(JSON.stringify(lastTickEvent) + "\n");
        } catch {
          clients.delete(socket);
        }
      },
      close(socket) {
        clients.delete(socket);
      },
      data() {},
      error(_socket, err) {
        console.error("Socket client error:", err.message);
      },
    },
  });

  return {
    stop() {
      bus.unsubscribe(broadcast);
      server.stop(true);
    },
  };
}
