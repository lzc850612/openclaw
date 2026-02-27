import { beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before imports that load the module.
// ---------------------------------------------------------------------------

const {
  countOpenGatesMock,
  createGateMock,
  loadTaskMock,
  transitionTaskMock,
  loadConfigMock,
  resolveDefaultAgentIdMock,
} = vi.hoisted(() => ({
  countOpenGatesMock: vi.fn(),
  createGateMock: vi.fn(),
  loadTaskMock: vi.fn(),
  transitionTaskMock: vi.fn(),
  loadConfigMock: vi.fn(),
  resolveDefaultAgentIdMock: vi.fn(),
}));

vi.mock("../../a2a/task-store.js", () => ({
  countOpenGates: (...args: unknown[]) => countOpenGatesMock(...args),
  createGate: (...args: unknown[]) => createGateMock(...args),
  loadTask: (...args: unknown[]) => loadTaskMock(...args),
  transitionTask: (...args: unknown[]) => transitionTaskMock(...args),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

vi.mock("../agent-scope.js", () => ({
  resolveDefaultAgentId: (cfg: unknown) => resolveDefaultAgentIdMock(cfg),
}));

vi.mock("../../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({ debug: vi.fn(), warn: vi.fn() }),
}));

// Import after mocks are set up.
import { createA2ACreateHumanGateTool } from "./create-human-gate-tool.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTask(status = "active") {
  return {
    taskId: "task-1",
    agentId: "main",
    role: "initiator" as const,
    remoteInstanceUrl: "http://peer.example.com",
    remoteAgentId: "agent-b",
    goal: "test goal",
    status,
    messages: [],
    gates: [],
  };
}

function setup(overrides?: { status?: string; maxGatesPerTask?: number; openGateCount?: number }) {
  const status = overrides?.status ?? "active";
  const openGateCount = overrides?.openGateCount ?? 0;

  const federationConfig: Record<string, unknown> = { enabled: true };
  if (overrides?.maxGatesPerTask !== undefined) {
    federationConfig.maxGatesPerTask = overrides.maxGatesPerTask;
  }

  loadConfigMock.mockReturnValue({ federation: federationConfig });
  resolveDefaultAgentIdMock.mockReturnValue("main");
  loadTaskMock.mockReturnValue(makeTask(status));
  transitionTaskMock.mockReturnValue(undefined);
  createGateMock.mockReturnValue(undefined);
  countOpenGatesMock.mockReturnValue(openGateCount);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("a2a_create_human_gate tool", () => {
  test("tool name and label are correct", () => {
    const tool = createA2ACreateHumanGateTool();
    expect(tool.name).toBe("a2a_create_human_gate");
    expect(tool.label).toBe("A2A");
  });

  test("happy path: creates gate, transitions to waiting-human, returns gateId", async () => {
    setup();
    const tool = createA2ACreateHumanGateTool({ agentSessionKey: "agent:main:a2a:task-1" });
    const result = await tool.execute("call-1", { question: "Is this OK?" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
      gateId: string;
      taskId: string;
      status: string;
    };
    expect(parsed.taskId).toBe("task-1");
    expect(parsed.status).toBe("waiting-human");
    expect(parsed.gateId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test("transitions task before creating gate", async () => {
    const callOrder: string[] = [];
    setup();
    transitionTaskMock.mockImplementation(() => {
      callOrder.push("transition");
    });
    createGateMock.mockImplementation(() => {
      callOrder.push("create-gate");
    });
    const tool = createA2ACreateHumanGateTool({ agentSessionKey: "agent:main:a2a:task-1" });
    await tool.execute("call-1", { question: "Is this OK?" });
    expect(callOrder).toEqual(["transition", "create-gate"]);
  });

  test("throws when taskId not resolvable", async () => {
    setup();
    const tool = createA2ACreateHumanGateTool(); // no session key
    await expect(tool.execute("call-1", { question: "Need approval?" })).rejects.toThrow(
      /taskId is required/,
    );
  });

  test("resolves taskId from explicit param when no session key", async () => {
    setup();
    const tool = createA2ACreateHumanGateTool();
    await tool.execute("call-1", { question: "Need approval?", taskId: "task-1" });
    expect(loadTaskMock.mock.calls[0]?.[1]).toBe("task-1");
  });

  test("throws when task not found", async () => {
    setup();
    loadTaskMock.mockReturnValue(null);
    const tool = createA2ACreateHumanGateTool({ agentSessionKey: "agent:main:a2a:task-1" });
    await expect(tool.execute("call-1", { question: "Need approval?" })).rejects.toThrow(
      /not found/,
    );
  });

  test("throws when too many open gates (default limit 5)", async () => {
    setup({ openGateCount: 5 });
    const tool = createA2ACreateHumanGateTool({ agentSessionKey: "agent:main:a2a:task-1" });
    await expect(tool.execute("call-1", { question: "Yet another question?" })).rejects.toThrow(
      /too many human escalations/,
    );
  });

  test("throws when too many open gates (custom maxGatesPerTask)", async () => {
    setup({ maxGatesPerTask: 2, openGateCount: 2 });
    const tool = createA2ACreateHumanGateTool({ agentSessionKey: "agent:main:a2a:task-1" });
    await expect(tool.execute("call-1", { question: "Another?" })).rejects.toThrow(
      /too many human escalations/,
    );
  });

  test("allows gate when open count is below limit", async () => {
    setup({ maxGatesPerTask: 3, openGateCount: 2 });
    const tool = createA2ACreateHumanGateTool({ agentSessionKey: "agent:main:a2a:task-1" });
    const result = await tool.execute("call-1", { question: "Under limit?" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
      status: string;
    };
    expect(parsed.status).toBe("waiting-human");
  });

  test("allows gate from waiting-human status (re-gate)", async () => {
    setup({ status: "waiting-human" });
    const tool = createA2ACreateHumanGateTool({ agentSessionKey: "agent:main:a2a:task-1" });
    const result = await tool.execute("call-1", { question: "Still need clarification?" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
      status: string;
    };
    expect(parsed.status).toBe("waiting-human");
  });

  test("gate count check uses pending count only (not answered)", async () => {
    // openGateCount=4 means 4 pending; below default limit of 5 so should succeed
    setup({ openGateCount: 4 });
    const tool = createA2ACreateHumanGateTool({ agentSessionKey: "agent:main:a2a:task-1" });
    const result = await tool.execute("call-1", { question: "One more?" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
      status: string;
    };
    expect(parsed.status).toBe("waiting-human");
    // countOpenGatesMock should have been called once
    expect(countOpenGatesMock).toHaveBeenCalledTimes(1);
  });

  test("createGate called with correct question", async () => {
    setup();
    const tool = createA2ACreateHumanGateTool({ agentSessionKey: "agent:main:a2a:task-1" });
    await tool.execute("call-1", { question: "Please confirm action X" });
    const gateArg = createGateMock.mock.calls[0]?.[2] as {
      question: string;
      status: string;
      taskId: string;
      agentId: string;
    };
    expect(gateArg.question).toBe("Please confirm action X");
    expect(gateArg.status).toBe("pending");
    expect(gateArg.taskId).toBe("task-1");
    expect(gateArg.agentId).toBe("main");
  });

  test("resolves agentId from session key", async () => {
    setup();
    const tool = createA2ACreateHumanGateTool({
      agentSessionKey: "agent:custom-agent:a2a:task-1",
    });
    await tool.execute("call-1", { question: "Who?" });
    expect(loadTaskMock.mock.calls[0]?.[0]).toBe("custom-agent");
    expect(transitionTaskMock.mock.calls[0]?.[0]).toBe("custom-agent");
  });

  test("resolves agentId from resolveDefaultAgentId when no session key", async () => {
    setup();
    const tool = createA2ACreateHumanGateTool();
    await tool.execute("call-1", { question: "Who?", taskId: "task-1" });
    expect(loadTaskMock.mock.calls[0]?.[0]).toBe("main");
  });
});
