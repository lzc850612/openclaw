import { beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { answerGateMock, transitionTaskMock, loadTaskMock, runA2AAgentTurnMock } = vi.hoisted(
  () => ({
    answerGateMock: vi.fn(),
    transitionTaskMock: vi.fn(),
    loadTaskMock: vi.fn(),
    runA2AAgentTurnMock: vi.fn(),
  }),
);

vi.mock("./task-store.js", () => ({
  answerGate: (...args: unknown[]) => answerGateMock(...args),
  transitionTask: (...args: unknown[]) => transitionTaskMock(...args),
  loadTask: (...args: unknown[]) => loadTaskMock(...args),
}));

vi.mock("./agent-turn.js", () => ({
  runA2AAgentTurn: (...args: unknown[]) => runA2AAgentTurnMock(...args),
}));

import type { OpenClawConfig } from "../config/types.openclaw.js";
// Import after mocks are set up.
import { resumeA2ATaskAfterGate } from "./resume.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseCfg: OpenClawConfig = {
  federation: { enabled: true, publicUrl: "http://localhost:18789" },
};

function makeTask() {
  return {
    taskId: "task-1",
    agentId: "main",
    role: "initiator" as const,
    remoteInstanceUrl: "http://peer.example.com",
    remoteAgentId: "agent-b",
    goal: "Do the thing",
    status: "waiting-human",
    messages: [],
    gates: [
      {
        id: "gate-1",
        taskId: "task-1",
        agentId: "main",
        question: "Is this OK?",
        status: "pending",
        createdAt: Date.now(),
      },
    ],
  };
}

function setup() {
  loadTaskMock.mockReturnValue(makeTask());
  answerGateMock.mockReturnValue(undefined);
  transitionTaskMock.mockReturnValue(undefined);
  runA2AAgentTurnMock.mockResolvedValue({ status: "ok" });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resumeA2ATaskAfterGate", () => {
  test("answers the gate before transitioning task", async () => {
    const callOrder: string[] = [];
    setup();
    answerGateMock.mockImplementation(() => {
      callOrder.push("answer-gate");
    });
    transitionTaskMock.mockImplementation(() => {
      callOrder.push("transition");
    });
    await resumeA2ATaskAfterGate({
      cfg: baseCfg,
      agentId: "main",
      taskId: "task-1",
      gateId: "gate-1",
      answer: "yes",
    });
    expect(callOrder[0]).toBe("answer-gate");
    expect(callOrder[1]).toBe("transition");
  });

  test("transitions task to active", async () => {
    setup();
    await resumeA2ATaskAfterGate({
      cfg: baseCfg,
      agentId: "main",
      taskId: "task-1",
      gateId: "gate-1",
      answer: "proceed",
    });
    expect(transitionTaskMock).toHaveBeenCalledWith("main", "task-1", "active");
  });

  test("calls answerGate with correct args", async () => {
    setup();
    await resumeA2ATaskAfterGate({
      cfg: baseCfg,
      agentId: "main",
      taskId: "task-1",
      gateId: "gate-1",
      answer: "my answer",
    });
    expect(answerGateMock).toHaveBeenCalledWith("main", "task-1", "gate-1", "my answer");
  });

  test("calls runA2AAgentTurn with context message containing the answer", async () => {
    setup();
    await resumeA2ATaskAfterGate({
      cfg: baseCfg,
      agentId: "main",
      taskId: "task-1",
      gateId: "gate-1",
      answer: "approved",
    });
    const callArgs = runA2AAgentTurnMock.mock.calls[0]?.[0] as {
      message: string;
      sessionKey: string;
      agentId: string;
    };
    expect(callArgs.message).toContain("gate-1");
    expect(callArgs.message).toContain("approved");
    expect(callArgs.agentId).toBe("main");
  });

  test("passes a2a session key for the correct agent and task", async () => {
    setup();
    await resumeA2ATaskAfterGate({
      cfg: baseCfg,
      agentId: "main",
      taskId: "task-1",
      gateId: "gate-1",
      answer: "yes",
    });
    const callArgs = runA2AAgentTurnMock.mock.calls[0]?.[0] as {
      sessionKey: string;
    };
    expect(callArgs.sessionKey).toBe("agent:main:a2a:task-1");
  });

  test("throws when task not found after resume", async () => {
    setup();
    loadTaskMock.mockReturnValue(null);
    await expect(
      resumeA2ATaskAfterGate({
        cfg: baseCfg,
        agentId: "main",
        taskId: "missing-task",
        gateId: "gate-1",
        answer: "yes",
      }),
    ).rejects.toThrow(/not found after resume/);
  });

  test("passes cfg to runA2AAgentTurn", async () => {
    setup();
    const customCfg: OpenClawConfig = {
      federation: { enabled: true, publicUrl: "http://custom.example.com" },
    };
    await resumeA2ATaskAfterGate({
      cfg: customCfg,
      agentId: "main",
      taskId: "task-1",
      gateId: "gate-1",
      answer: "ok",
    });
    const callArgs = runA2AAgentTurnMock.mock.calls[0]?.[0] as {
      cfg: OpenClawConfig;
    };
    expect(callArgs.cfg).toBe(customCfg);
  });
});
