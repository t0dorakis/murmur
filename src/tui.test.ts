import { describe, test, expect, afterEach } from "bun:test";
import { createTestScreen } from "./screen.ts";
import { createTui, type Tui } from "./tui.ts";
import { createEventBus } from "./events.ts";
import type { WorkspaceStatus } from "./types.ts";

let activeTui: Tui | null = null;

afterEach(() => {
  activeTui?.stop();
  activeTui = null;
});

function setup(cols = 80, rows = 24) {
  const screen = createTestScreen(cols, rows);
  const bus = createEventBus();
  const tui = createTui(bus, screen);
  activeTui = tui;
  return { screen, bus, tui };
}

function makeWorkspace(overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return {
    path: "/tmp/test-ws",
    name: "test-ws",
    interval: "1h",
    nextRunAt: Date.now() + 3600_000,
    lastOutcome: null,
    lastRunAt: null,
    ...overrides,
  };
}

describe("tui rendering", () => {
  test("shows header with pid and workspace count", () => {
    const { screen, bus, tui } = setup();
    tui.start();

    bus.emit({ type: "daemon:ready", pid: 42, workspaceCount: 2 });
    bus.emit({
      type: "tick",
      workspaces: [makeWorkspace(), makeWorkspace({ path: "/tmp/ws2", name: "ws2" })],
    });

    expect(screen.text()).toContain("murmur");
    expect(screen.text()).toContain("2 workspaces");
    expect(screen.text()).toContain("pid 42");
  });

  test("shows workspace name and interval", () => {
    const { screen, bus, tui } = setup();
    tui.start();

    bus.emit({
      type: "tick",
      workspaces: [makeWorkspace({ name: "my-project", interval: "30m" })],
    });

    expect(screen.text()).toContain("my-project");
    expect(screen.text()).toContain("30m");
  });

  test("shows singular 'workspace' for one workspace", () => {
    const { screen, bus, tui } = setup();
    tui.start();

    bus.emit({ type: "daemon:ready", pid: 1, workspaceCount: 1 });
    bus.emit({ type: "tick", workspaces: [makeWorkspace()] });

    expect(screen.text()).toContain("1 workspace ");
    expect(screen.text()).not.toContain("1 workspaces");
  });

  test("shows waiting message when no feed entries", () => {
    const { screen, bus, tui } = setup();
    tui.start();

    bus.emit({ type: "tick", workspaces: [makeWorkspace()] });

    expect(screen.text()).toContain("Waiting for first heartbeat");
  });

  test("shows empty state when no workspaces", () => {
    const { screen, bus, tui } = setup();
    tui.start();

    bus.emit({ type: "tick", workspaces: [] });

    expect(screen.text()).toContain("No workspaces configured");
  });

  test("shows active beat output during heartbeat", () => {
    const { screen, bus, tui } = setup();
    tui.start();

    bus.emit({ type: "tick", workspaces: [makeWorkspace({ path: "/tmp/ws" })] });
    bus.emit({ type: "heartbeat:start", workspace: "/tmp/ws", promptPreview: "Check issues" });
    bus.emit({ type: "heartbeat:stdout", workspace: "/tmp/ws", chunk: "Checking 3 repos..." });

    expect(screen.text()).toContain("test-ws");
    expect(screen.text()).toContain("Checking 3 repos");
  });

  test("shows completed entry with ok outcome", () => {
    const { screen, bus, tui } = setup();
    tui.start();

    bus.emit({ type: "tick", workspaces: [makeWorkspace({ path: "/tmp/ws" })] });
    bus.emit({ type: "heartbeat:start", workspace: "/tmp/ws", promptPreview: "Check issues" });
    bus.emit({
      type: "heartbeat:done",
      workspace: "/tmp/ws",
      entry: { ts: new Date().toISOString(), workspace: "/tmp/ws", outcome: "ok", durationMs: 1500 },
    });

    expect(screen.text()).toContain("ok");
    expect(screen.text()).toContain("1.5s");
  });

  test("shows completed entry with attention outcome", () => {
    const { screen, bus, tui } = setup();
    tui.start();

    bus.emit({ type: "tick", workspaces: [makeWorkspace({ path: "/tmp/ws" })] });
    bus.emit({ type: "heartbeat:start", workspace: "/tmp/ws", promptPreview: "Check email" });
    bus.emit({
      type: "heartbeat:done",
      workspace: "/tmp/ws",
      entry: {
        ts: new Date().toISOString(),
        workspace: "/tmp/ws",
        outcome: "attention",
        durationMs: 3200,
        summary: "3 urgent emails",
      },
    });

    expect(screen.text()).toContain("attention");
    expect(screen.text()).toContain("3.2s");
  });

  test("alt screen and cursor codes sent on start/stop", () => {
    const { screen, tui } = setup();

    tui.start();
    expect(screen.buffer).toContain("\x1b[?1049h"); // alt screen on
    expect(screen.buffer).toContain("\x1b[?25l"); // cursor hide

    tui.stop();
    activeTui = null; // already stopped, prevent double-stop
    expect(screen.buffer).toContain("\x1b[?25h"); // cursor show
    expect(screen.buffer).toContain("\x1b[?1049l"); // alt screen off
  });

  test("shows cron expression for cron workspace", () => {
    const { screen, bus, tui } = setup();
    tui.start();

    bus.emit({
      type: "tick",
      workspaces: [makeWorkspace({ name: "briefing", interval: "0 9 * * *" })],
    });

    expect(screen.text()).toContain("briefing");
    expect(screen.text()).toContain("0 9 * * *");
  });

  test("shows absolute time for distant next run", () => {
    const { screen, bus, tui } = setup();
    tui.start();

    // Next run in 5 hours — should show absolute time like "next at HH:MM"
    const nextRunAt = Date.now() + 5 * 3_600_000;
    const expectedTime = new Date(nextRunAt);
    const hh = String(expectedTime.getHours()).padStart(2, "0");
    const mm = String(expectedTime.getMinutes()).padStart(2, "0");

    bus.emit({
      type: "tick",
      workspaces: [makeWorkspace({ name: "daily", interval: "0 9 * * *", nextRunAt })],
    });

    expect(screen.text()).toContain(`next at`);
    expect(screen.text()).toContain(`${hh}:${mm}`);
  });

  test("clears active beat after heartbeat:done", () => {
    const { screen, bus, tui } = setup();
    tui.start();

    bus.emit({ type: "tick", workspaces: [makeWorkspace({ path: "/tmp/ws" })] });
    bus.emit({ type: "heartbeat:start", workspace: "/tmp/ws", promptPreview: "Check" });
    bus.emit({ type: "heartbeat:stdout", workspace: "/tmp/ws", chunk: "working..." });

    expect(screen.text()).toContain("working...");

    screen.clear();
    bus.emit({
      type: "heartbeat:done",
      workspace: "/tmp/ws",
      entry: { ts: new Date().toISOString(), workspace: "/tmp/ws", outcome: "ok", durationMs: 500 },
    });

    expect(screen.text()).not.toContain("running");
  });
});
