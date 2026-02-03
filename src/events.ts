import type { DaemonEvent } from "./types.ts";

export type EventCallback = (event: DaemonEvent) => void;

export type EventBus = {
  emit(event: DaemonEvent): void;
  subscribe(callback: EventCallback): void;
  unsubscribe(callback: EventCallback): void;
};

export function createEventBus(): EventBus {
  const listeners: EventCallback[] = [];

  return {
    emit(event) {
      for (const cb of listeners) cb(event);
    },
    subscribe(callback) {
      listeners.push(callback);
    },
    unsubscribe(callback) {
      const idx = listeners.indexOf(callback);
      if (idx !== -1) listeners.splice(idx, 1);
    },
  };
}
