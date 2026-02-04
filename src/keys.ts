export type KeyAction = "quit" | "detach" | null;

export function mapKeyToAction(data: Buffer): KeyAction {
  const key = data.toString();
  if (key === "q" || key === "\x03") return "quit";
  if (key === "\x04") return "detach";
  return null;
}
