import { beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { loadGatesMock } = vi.hoisted(() => ({
  loadGatesMock: vi.fn(),
}));

vi.mock("./task-store.js", () => ({
  loadGates: (...args: unknown[]) => loadGatesMock(...args),
}));

// Import after mocks are set up.
import { findOpenGate } from "./gate-recognizer.js";
import type { HumanGate } from "./task-store.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGate(overrides?: Partial<HumanGate>): HumanGate {
  return {
    id: "gate-1",
    taskId: "task-1",
    agentId: "main",
    question: "Is this OK?",
    status: "pending",
    createdAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findOpenGate", () => {
  test("returns null when task has no gates", () => {
    loadGatesMock.mockReturnValue([]);
    const result = findOpenGate("main", "task-1");
    expect(result).toBeNull();
  });

  test("returns null when all gates are answered", () => {
    loadGatesMock.mockReturnValue([
      makeGate({ status: "answered", answer: "yes" }),
      makeGate({ id: "gate-2", status: "answered", answer: "no" }),
    ]);
    const result = findOpenGate("main", "task-1");
    expect(result).toBeNull();
  });

  test("returns the first pending gate", () => {
    const pending = makeGate({ id: "gate-pending" });
    loadGatesMock.mockReturnValue([makeGate({ id: "gate-answered", status: "answered" }), pending]);
    const result = findOpenGate("main", "task-1");
    expect(result).not.toBeNull();
    expect(result?.id).toBe("gate-pending");
  });

  test("returns the first pending gate when multiple pending gates exist", () => {
    const first = makeGate({ id: "gate-first" });
    const second = makeGate({ id: "gate-second" });
    loadGatesMock.mockReturnValue([first, second]);
    const result = findOpenGate("main", "task-1");
    expect(result?.id).toBe("gate-first");
  });

  test("passes agentId and taskId to loadGates", () => {
    loadGatesMock.mockReturnValue([]);
    findOpenGate("my-agent", "my-task");
    expect(loadGatesMock).toHaveBeenCalledWith("my-agent", "my-task", undefined);
  });

  test("forwards optional stateDir to loadGates", () => {
    loadGatesMock.mockReturnValue([]);
    findOpenGate("my-agent", "my-task", "/tmp/state");
    expect(loadGatesMock).toHaveBeenCalledWith("my-agent", "my-task", "/tmp/state");
  });
});
