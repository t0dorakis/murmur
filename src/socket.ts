import type { EventBus } from "./events.ts";
import type { DaemonEvent } from "./types.ts";

export type SocketServer = {
  stop(): void;
};

export function startSocketServer(bus: EventBus, socketPath: string): SocketServer {
  const clients = new Set<{ write(data: string): void }>();

  function broadcast(event: DaemonEvent) {
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
        // Send current state as first message
        const ready: DaemonEvent = { type: "daemon:ready", pid: process.pid, workspaceCount: 0 };
        try { socket.write(JSON.stringify(ready) + "\n"); } catch {}
      },
      close(socket) {
        clients.delete(socket);
      },
      data() {
        // Clients are passive consumers — ignore incoming data
      },
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
