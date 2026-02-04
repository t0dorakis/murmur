export type KeyAction = "quit" | "detach" | null;

export function mapKeyToAction(data: Buffer): KeyAction {
  const key = data.toString();
  if (key === "q" || key === "\x03") return "quit";
  if (key === "\x04") return "detach";
  return null;
}

export type KeyHandler = {
  start(callbacks: { onQuit(): void; onDetach(): void }): void;
  stop(): void;
};

export function createKeyHandler(): KeyHandler {
  let active = false;
  let callbacks: { onQuit(): void; onDetach(): void } | null = null;

  function onData(data: Buffer) {
    if (!callbacks) return;
    const action = mapKeyToAction(data);
    if (action === "quit") callbacks.onQuit();
    else if (action === "detach") callbacks.onDetach();
  }

  return {
    start(newCallbacks) {
      callbacks = newCallbacks;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("data", onData);
        active = true;
      }
    },
    stop() {
      if (active) {
        process.stdin.removeListener("data", onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        active = false;
      }
      callbacks = null;
    },
  };
}
