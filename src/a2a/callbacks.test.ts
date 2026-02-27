import { beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before any imports that load the modules.
// ---------------------------------------------------------------------------

const { runA2AAgentTurnMock } = vi.hoisted(() => ({
  runA2AAgentTurnMock: vi.fn(),
}));

vi.mock("./agent-turn.js", () => ({
  runA2AAgentTurn: (...args: unknown[]) => runA2AAgentTurnMock(...args),
}));

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({ debug: vi.fn(), warn: vi.fn() }),
}));

import type { OpenClawConfig } from "../config/types.openclaw.js";
// Import after mocks are set up.
import { dispatchCompletionCallback, dispatchParticipantNotification } from "./callbacks.js";
import type { A2ATask } from "./task-store.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const cfg: OpenClawConfig = {
  federation: { enabled: true, publicUrl: "http://instance-a.example.com" },
};

function makeInitiatorTask(overrides?: Partial<A2ATask>): A2ATask {
  return {
    taskId: "task-abc",
    agentId: "main",
    role: "initiator",
    remoteInstanceUrl: "http://instance-b.example.com",
    remoteAgentId: "agent-b",
    goal: "Summarise the quarterly report",
    status: "closed",
    createdAtMs: 1_000_000,
    updatedAtMs: 1_000_100,
    messages: [],
    callbackSessionKey: "agent:main:telegram:user-123",
    ...overrides,
  };
}

function makeResponderTask(overrides?: Partial<A2ATask>): A2ATask {
  return {
    taskId: "task-xyz",
    agentId: "main",
    role: "responder",
    remoteInstanceUrl: "http://instance-a.example.com",
    remoteAgentId: "agent-a",
    goal: "Summarise the quarterly report",
    status: "closed",
    createdAtMs: 1_000_000,
    updatedAtMs: 1_000_100,
    messages: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runA2AAgentTurnMock.mockResolvedValue({ status: "ok" });
});

// ---------------------------------------------------------------------------
// dispatchCompletionCallback
// ---------------------------------------------------------------------------

describe("dispatchCompletionCallback", () => {
  test("calls runA2AAgentTurn with the callbackSessionKey for an initiator task", async () => {
    const task = makeInitiatorTask();
    await dispatchCompletionCallback({ cfg, agentId: "main", task });

    expect(runA2AAgentTurnMock).toHaveBeenCalledOnce();
    const callArgs = runA2AAgentTurnMock.mock.calls[0]?.[0] as {
      sessionKey: string;
      message: string;
    };
    expect(callArgs.sessionKey).toBe("agent:main:telegram:user-123");
  });

  test("does nothing when task has no callbackSessionKey", async () => {
    const task = makeInitiatorTask({ callbackSessionKey: undefined });
    await dispatchCompletionCallback({ cfg, agentId: "main", task });
    expect(runA2AAgentTurnMock).not.toHaveBeenCalled();
  });

  test("does nothing for a responder task even if callbackSessionKey is set", async () => {
    const task = makeResponderTask({
      callbackSessionKey: "agent:main:telegram:user-456",
    } as Partial<A2ATask>);
    await dispatchCompletionCallback({ cfg, agentId: "main", task });
    expect(runA2AAgentTurnMock).not.toHaveBeenCalled();
  });

  test("summary message contains taskId", async () => {
    const task = makeInitiatorTask({ taskId: "task-42" });
    await dispatchCompletionCallback({ cfg, agentId: "main", task });

    const callArgs = runA2AAgentTurnMock.mock.calls[0]?.[0] as { message: string };
    expect(callArgs.message).toContain("task-42");
  });

  test("summary message contains remoteAgentId", async () => {
    const task = makeInitiatorTask({ remoteAgentId: "remote-agent-xyz" });
    await dispatchCompletionCallback({ cfg, agentId: "main", task });

    const callArgs = runA2AAgentTurnMock.mock.calls[0]?.[0] as { message: string };
    expect(callArgs.message).toContain("remote-agent-xyz");
  });

  test("summary message contains remoteInstanceUrl", async () => {
    const task = makeInitiatorTask({ remoteInstanceUrl: "http://remote.example.com" });
    await dispatchCompletionCallback({ cfg, agentId: "main", task });

    const callArgs = runA2AAgentTurnMock.mock.calls[0]?.[0] as { message: string };
    expect(callArgs.message).toContain("http://remote.example.com");
  });

  test("summary message contains goal", async () => {
    const task = makeInitiatorTask({ goal: "Book a flight to Berlin" });
    await dispatchCompletionCallback({ cfg, agentId: "main", task });

    const callArgs = runA2AAgentTurnMock.mock.calls[0]?.[0] as { message: string };
    expect(callArgs.message).toContain("Book a flight to Berlin");
  });

  test("passes cfg, agentId, and task to runA2AAgentTurn", async () => {
    const task = makeInitiatorTask();
    await dispatchCompletionCallback({ cfg, agentId: "main", task });

    const callArgs = runA2AAgentTurnMock.mock.calls[0]?.[0] as {
      cfg: OpenClawConfig;
      agentId: string;
      task: A2ATask;
    };
    expect(callArgs.cfg).toBe(cfg);
    expect(callArgs.agentId).toBe("main");
    expect(callArgs.task).toBe(task);
  });
});

// ---------------------------------------------------------------------------
// dispatchParticipantNotification
// ---------------------------------------------------------------------------

describe("dispatchParticipantNotification", () => {
  test("does not call runA2AAgentTurn for a responder task", async () => {
    const task = makeResponderTask();
    await dispatchParticipantNotification({ cfg, agentId: "main", task });
    expect(runA2AAgentTurnMock).not.toHaveBeenCalled();
  });

  test("does nothing for an initiator task", async () => {
    const task = makeInitiatorTask();
    await dispatchParticipantNotification({ cfg, agentId: "main", task });
    expect(runA2AAgentTurnMock).not.toHaveBeenCalled();
  });

  test("resolves without throwing for a responder task", async () => {
    const task = makeResponderTask();
    await expect(
      dispatchParticipantNotification({ cfg, agentId: "main", task }),
    ).resolves.toBeUndefined();
  });
});
