import { describe, expect, test } from "vitest";
import { buildA2AMessageHeader, buildA2ASystemPromptBlock } from "./agent-prompt.js";
import type { A2ATask } from "./task-store.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTask(overrides?: Partial<A2ATask>): A2ATask {
  return {
    taskId: "task-abc-123",
    agentId: "main",
    role: "initiator",
    remoteInstanceUrl: "http://peer.example.com",
    remoteAgentId: "agent-remote",
    goal: "Negotiate a price for the goods",
    status: "active",
    messages: [],
    createdAtMs: 1_000_000,
    updatedAtMs: 1_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildA2ASystemPromptBlock
// ---------------------------------------------------------------------------

describe("buildA2ASystemPromptBlock", () => {
  test("output contains role", () => {
    const block = buildA2ASystemPromptBlock(makeTask({ role: "responder" }));
    expect(block).toContain("responder");
  });

  test("output contains remoteAgentId", () => {
    const block = buildA2ASystemPromptBlock(makeTask({ remoteAgentId: "agent-remote" }));
    expect(block).toContain("agent-remote");
  });

  test("output contains remoteInstanceUrl", () => {
    const block = buildA2ASystemPromptBlock(
      makeTask({ remoteInstanceUrl: "http://peer.example.com" }),
    );
    expect(block).toContain("http://peer.example.com");
  });

  test("output contains goal", () => {
    const block = buildA2ASystemPromptBlock(makeTask({ goal: "Negotiate a price for the goods" }));
    expect(block).toContain("Negotiate a price for the goods");
  });

  test("output contains taskId", () => {
    const block = buildA2ASystemPromptBlock(makeTask({ taskId: "task-abc-123" }));
    expect(block).toContain("task-abc-123");
  });

  test("output contains A2A Session Context heading", () => {
    const block = buildA2ASystemPromptBlock(makeTask());
    expect(block).toContain("## A2A Session Context");
  });

  test("initiator role is reflected in the output", () => {
    const block = buildA2ASystemPromptBlock(makeTask({ role: "initiator" }));
    expect(block).toContain("initiator");
  });
});

// ---------------------------------------------------------------------------
// buildA2AMessageHeader
// ---------------------------------------------------------------------------

describe("buildA2AMessageHeader", () => {
  test("output matches expected format", () => {
    const header = buildA2AMessageHeader({
      fromAgentId: "agent-b",
      fromInstanceUrl: "http://b.example.com",
      taskId: "task-xyz",
      roundNumber: 3,
    });
    expect(header).toBe("[A2A | From: agent-b@http://b.example.com | Round: 3 | Task: task-xyz]");
  });

  test("round number 0 is formatted correctly", () => {
    const header = buildA2AMessageHeader({
      fromAgentId: "agent-x",
      fromInstanceUrl: "http://x.example.com",
      taskId: "task-001",
      roundNumber: 0,
    });
    expect(header).toContain("Round: 0");
  });

  test("includes fromAgentId in output", () => {
    const header = buildA2AMessageHeader({
      fromAgentId: "some-agent",
      fromInstanceUrl: "http://host.example.com",
      taskId: "t1",
      roundNumber: 1,
    });
    expect(header).toContain("some-agent");
  });

  test("includes fromInstanceUrl in output", () => {
    const header = buildA2AMessageHeader({
      fromAgentId: "a",
      fromInstanceUrl: "http://custom-host.example.com",
      taskId: "t2",
      roundNumber: 2,
    });
    expect(header).toContain("http://custom-host.example.com");
  });

  test("includes taskId in output", () => {
    const header = buildA2AMessageHeader({
      fromAgentId: "a",
      fromInstanceUrl: "http://host.example.com",
      taskId: "special-task-id",
      roundNumber: 5,
    });
    expect(header).toContain("special-task-id");
  });
});
