import { beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before imports that load the module.
// ---------------------------------------------------------------------------

const {
  enqueueAndSendMock,
  loadTaskMock,
  transitionTaskMock,
  loadConfigMock,
  resolveDefaultAgentIdMock,
} = vi.hoisted(() => ({
  enqueueAndSendMock: vi.fn(),
  loadTaskMock: vi.fn(),
  transitionTaskMock: vi.fn(),
  loadConfigMock: vi.fn(),
  resolveDefaultAgentIdMock: vi.fn(),
}));

vi.mock("../../a2a/message-queue.js", () => ({
  enqueueAndSend: (opts: unknown) => enqueueAndSendMock(opts),
}));

vi.mock("../../a2a/task-store.js", () => ({
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
import { createA2ACompletingTool } from "./a2a-completing-tool.js";

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
    goal: "test",
    status,
    messages: [],
  };
}

function setup(overrides?: { status?: string; publicUrl?: string | null; sendOk?: boolean }) {
  const status = overrides?.status ?? "active";
  const publicUrl =
    overrides?.publicUrl === undefined ? "http://localhost:18789" : overrides.publicUrl;
  const sendOk = overrides?.sendOk ?? true;

  loadConfigMock.mockReturnValue({
    federation: { enabled: true, ...(publicUrl ? { publicUrl } : {}) },
  });
  resolveDefaultAgentIdMock.mockReturnValue("main");
  loadTaskMock.mockReturnValue(makeTask(status));
  transitionTaskMock.mockReturnValue(undefined);
  enqueueAndSendMock.mockResolvedValue(
    sendOk ? { ok: true } : { ok: false, error: "connection refused" },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("a2a_send_completing tool", () => {
  test("tool name and label are correct", () => {
    const tool = createA2ACompletingTool();
    expect(tool.name).toBe("a2a_send_completing");
    expect(tool.label).toBe("A2A");
  });

  test("happy path: transitions task to completing and returns status", async () => {
    setup();
    const tool = createA2ACompletingTool({ agentSessionKey: "agent:main:a2a:task-1" });
    const result = await tool.execute("call-1", { result: "All done" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
      taskId: string;
      status: string;
      messageSent: boolean;
    };
    expect(parsed.taskId).toBe("task-1");
    expect(parsed.status).toBe("completing");
    expect(parsed.messageSent).toBe(true);
  });

  test("calls transitionTask before enqueueAndSend", async () => {
    const callOrder: string[] = [];
    setup();
    transitionTaskMock.mockImplementation(() => {
      callOrder.push("transition");
    });
    enqueueAndSendMock.mockImplementation(async () => {
      callOrder.push("send");
      return { ok: true };
    });

    const tool = createA2ACompletingTool({ agentSessionKey: "agent:main:a2a:task-1" });
    await tool.execute("call-1", { result: "Done" });
    expect(callOrder).toEqual(["transition", "send"]);
  });

  test("passes result as content to enqueueAndSend", async () => {
    setup();
    const tool = createA2ACompletingTool({ agentSessionKey: "agent:main:a2a:task-1" });
    await tool.execute("call-1", { result: "Mission accomplished" });
    const sendCall = enqueueAndSendMock.mock.calls[0]?.[0] as {
      message: { content: string; type: string };
    };
    expect(sendCall.message.content).toBe("Mission accomplished");
    expect(sendCall.message.type).toBe("completing");
  });

  test("resolves agentId from session key", async () => {
    setup();
    const tool = createA2ACompletingTool({ agentSessionKey: "agent:my-agent:a2a:task-1" });
    loadTaskMock.mockReturnValue(makeTask());
    await tool.execute("call-1", { result: "Done" });
    // loadTask and transitionTask should be called with the agent from session key
    expect(loadTaskMock.mock.calls[0]?.[0]).toBe("my-agent");
    expect(transitionTaskMock.mock.calls[0]?.[0]).toBe("my-agent");
  });

  test("resolves agentId from resolveDefaultAgentId when no session key", async () => {
    setup();
    const tool = createA2ACompletingTool();
    await tool.execute("call-1", { result: "Done", taskId: "task-1" });
    // Should fall back to resolveDefaultAgentId which returns "main"
    expect(loadTaskMock.mock.calls[0]?.[0]).toBe("main");
  });

  test("uses explicit taskId parameter over session key", async () => {
    setup();
    const tool = createA2ACompletingTool({ agentSessionKey: "agent:main:a2a:from-session" });
    loadTaskMock.mockReturnValue({ ...makeTask(), taskId: "explicit-task" });
    await tool.execute("call-1", { result: "Done", taskId: "explicit-task" });
    expect(loadTaskMock.mock.calls[0]?.[1]).toBe("explicit-task");
  });

  test("throws when taskId cannot be resolved", async () => {
    setup();
    // No session key and no taskId param
    const tool = createA2ACompletingTool();
    await expect(tool.execute("call-1", { result: "Done" })).rejects.toThrow(/taskId is required/);
  });

  test("throws when federation.publicUrl is not configured", async () => {
    setup({ publicUrl: null });
    const tool = createA2ACompletingTool({ agentSessionKey: "agent:main:a2a:task-1" });
    await expect(tool.execute("call-1", { result: "Done" })).rejects.toThrow(/publicUrl/);
  });

  test("throws when task is not found", async () => {
    setup();
    loadTaskMock.mockReturnValue(null);
    const tool = createA2ACompletingTool({ agentSessionKey: "agent:main:a2a:task-1" });
    await expect(tool.execute("call-1", { result: "Done" })).rejects.toThrow(/not found/);
  });

  test("throws when task is already in completing status", async () => {
    setup({ status: "completing" });
    const tool = createA2ACompletingTool({ agentSessionKey: "agent:main:a2a:task-1" });
    await expect(tool.execute("call-1", { result: "Done" })).rejects.toThrow(/completing/);
  });

  test("throws when task is in closed status", async () => {
    setup({ status: "closed" });
    const tool = createA2ACompletingTool({ agentSessionKey: "agent:main:a2a:task-1" });
    await expect(tool.execute("call-1", { result: "Done" })).rejects.toThrow(/status/);
  });

  test("throws when task is in failed status", async () => {
    setup({ status: "failed" });
    const tool = createA2ACompletingTool({ agentSessionKey: "agent:main:a2a:task-1" });
    await expect(tool.execute("call-1", { result: "Done" })).rejects.toThrow(/status/);
  });

  test("allows send from waiting-human status", async () => {
    setup({ status: "waiting-human" });
    const tool = createA2ACompletingTool({ agentSessionKey: "agent:main:a2a:task-1" });
    const result = await tool.execute("call-1", { result: "Done" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as { status: string };
    expect(parsed.status).toBe("completing");
  });

  test("reports messageSent=false when enqueueAndSend fails", async () => {
    setup({ sendOk: false });
    const tool = createA2ACompletingTool({ agentSessionKey: "agent:main:a2a:task-1" });
    const result = await tool.execute("call-1", { result: "Done" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
      messageSent: boolean;
      status: string;
    };
    // Task still transitions even if send fails
    expect(parsed.status).toBe("completing");
    expect(parsed.messageSent).toBe(false);
  });

  test("returned messageId is a valid UUID", async () => {
    setup();
    const tool = createA2ACompletingTool({ agentSessionKey: "agent:main:a2a:task-1" });
    const result = await tool.execute("call-1", { result: "Done" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
      messageId: string;
    };
    expect(parsed.messageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
