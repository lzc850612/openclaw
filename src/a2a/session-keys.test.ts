import { describe, expect, test } from "vitest";
import {
  buildA2ASessionKey,
  isA2ASessionKey,
  parseA2AAgentId,
  parseA2ATaskId,
} from "./session-keys.js";

describe("buildA2ASessionKey", () => {
  test("builds agent:<agentId>:a2a:<taskId>", () => {
    expect(buildA2ASessionKey("alice", "task-123")).toBe("agent:alice:a2a:task-123");
  });

  test("preserves hyphens in taskId", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(buildA2ASessionKey("bob", uuid)).toBe(`agent:bob:a2a:${uuid}`);
  });
});

describe("isA2ASessionKey", () => {
  test("returns true for valid A2A session keys", () => {
    expect(isA2ASessionKey("agent:alice:a2a:task-1")).toBe(true);
  });

  test("returns false for cron session keys", () => {
    expect(isA2ASessionKey("agent:alice:cron:job-1")).toBe(false);
  });

  test("returns false for acp session keys", () => {
    expect(isA2ASessionKey("agent:alice:acp:session-1")).toBe(false);
  });

  test("returns false for bare non-agent keys", () => {
    expect(isA2ASessionKey("a2a:task-1")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isA2ASessionKey("")).toBe(false);
  });

  test("returns false for main session key", () => {
    expect(isA2ASessionKey("agent:alice:main")).toBe(false);
  });
});

describe("parseA2ATaskId", () => {
  test("extracts taskId from a valid A2A session key", () => {
    expect(parseA2ATaskId("agent:alice:a2a:task-123")).toBe("task-123");
  });

  test("returns null for non-A2A session keys", () => {
    expect(parseA2ATaskId("agent:alice:cron:job-1")).toBeNull();
  });

  test("returns null for empty input", () => {
    expect(parseA2ATaskId("")).toBeNull();
  });

  test("preserves UUID format in taskId", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseA2ATaskId(`agent:bob:a2a:${uuid}`)).toBe(uuid);
  });
});

describe("parseA2AAgentId", () => {
  test("extracts agentId from a valid A2A session key", () => {
    expect(parseA2AAgentId("agent:alice:a2a:task-1")).toBe("alice");
  });

  test("returns null for non-A2A session keys", () => {
    expect(parseA2AAgentId("agent:alice:cron:job-1")).toBeNull();
  });

  test("returns null for empty input", () => {
    expect(parseA2AAgentId("")).toBeNull();
  });
});
