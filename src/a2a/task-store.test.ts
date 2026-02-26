import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  appendMessage,
  createTask,
  listAllTaskIds,
  listTasksByStatus,
  loadTask,
  patchTask,
  transitionTask,
} from "./task-store.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-a2a-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const AGENT_ID = "test-agent";
const TASK_ID = "task-001";

function baseTask() {
  return {
    taskId: TASK_ID,
    agentId: AGENT_ID,
    role: "initiator" as const,
    remoteInstanceUrl: "http://peer.example.com",
    remoteAgentId: "remote-agent",
    goal: "book a meeting",
    status: "active" as const,
  };
}

describe("createTask", () => {
  test("creates a task file and returns the task", () => {
    const task = createTask(baseTask(), tmpDir);
    expect(task.taskId).toBe(TASK_ID);
    expect(task.status).toBe("active");
    expect(task.messages).toEqual([]);
    expect(typeof task.createdAtMs).toBe("number");
  });

  test("persists to disk so loadTask can read it back", () => {
    createTask(baseTask(), tmpDir);
    const loaded = loadTask(AGENT_ID, TASK_ID, tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.taskId).toBe(TASK_ID);
    expect(loaded?.role).toBe("initiator");
  });

  test("throws if task already exists", () => {
    createTask(baseTask(), tmpDir);
    expect(() => createTask(baseTask(), tmpDir)).toThrow(/already exists/);
  });
});

describe("loadTask", () => {
  test("returns null when task file does not exist", () => {
    expect(loadTask(AGENT_ID, "missing-task", tmpDir)).toBeNull();
  });
});

describe("patchTask", () => {
  test("updates non-status fields and persists", () => {
    createTask(baseTask(), tmpDir);
    const updated = patchTask(AGENT_ID, TASK_ID, { goal: "reschedule meeting" }, tmpDir);
    expect(updated.goal).toBe("reschedule meeting");
    const reloaded = loadTask(AGENT_ID, TASK_ID, tmpDir);
    expect(reloaded?.goal).toBe("reschedule meeting");
  });

  test("throws when task does not exist", () => {
    expect(() => patchTask(AGENT_ID, "missing", {}, tmpDir)).toThrow(/not found/);
  });
});

describe("transitionTask", () => {
  test("transitions active → completing and persists", () => {
    createTask(baseTask(), tmpDir);
    const updated = transitionTask(AGENT_ID, TASK_ID, "completing", tmpDir);
    expect(updated.status).toBe("completing");
    expect(loadTask(AGENT_ID, TASK_ID, tmpDir)?.status).toBe("completing");
  });

  test("no-ops if status is already the target", () => {
    createTask(baseTask(), tmpDir);
    const result = transitionTask(AGENT_ID, TASK_ID, "active", tmpDir);
    expect(result.status).toBe("active");
  });

  test("throws on illegal transitions", () => {
    createTask(baseTask(), tmpDir);
    expect(() => transitionTask(AGENT_ID, TASK_ID, "closed", tmpDir)).toThrow(/invalid transition/);
  });

  test("full happy path: active → completing → closed", () => {
    createTask(baseTask(), tmpDir);
    transitionTask(AGENT_ID, TASK_ID, "completing", tmpDir);
    const final = transitionTask(AGENT_ID, TASK_ID, "closed", tmpDir);
    expect(final.status).toBe("closed");
  });
});

describe("appendMessage", () => {
  const msg = {
    messageId: "msg-1",
    fromInstanceUrl: "http://peer.example.com",
    fromAgentId: "remote-agent",
    type: "task.reply",
    content: "Done!",
    receivedAtMs: Date.now(),
  };

  test("appends a message to the task", () => {
    createTask(baseTask(), tmpDir);
    const updated = appendMessage(AGENT_ID, TASK_ID, msg, tmpDir);
    expect(updated.messages).toHaveLength(1);
    expect(updated.messages[0]?.messageId).toBe("msg-1");
  });

  test("is idempotent — duplicate messageId is skipped", () => {
    createTask(baseTask(), tmpDir);
    appendMessage(AGENT_ID, TASK_ID, msg, tmpDir);
    const result = appendMessage(AGENT_ID, TASK_ID, msg, tmpDir);
    expect(result.messages).toHaveLength(1);
  });

  test("throws when task is in terminal state", () => {
    createTask(baseTask(), tmpDir);
    transitionTask(AGENT_ID, TASK_ID, "completing", tmpDir);
    transitionTask(AGENT_ID, TASK_ID, "closed", tmpDir);
    expect(() => appendMessage(AGENT_ID, TASK_ID, msg, tmpDir)).toThrow(/closed/);
  });
});

describe("listAllTaskIds", () => {
  test("returns empty array when no tasks exist", () => {
    expect(listAllTaskIds(AGENT_ID, tmpDir)).toEqual([]);
  });

  test("returns IDs of all tasks", () => {
    createTask(baseTask(), tmpDir);
    createTask({ ...baseTask(), taskId: "task-002" }, tmpDir);
    const ids = listAllTaskIds(AGENT_ID, tmpDir).toSorted();
    expect(ids).toEqual(["task-001", "task-002"]);
  });
});

describe("listTasksByStatus", () => {
  test("returns only tasks matching requested statuses", () => {
    createTask(baseTask(), tmpDir);
    createTask({ ...baseTask(), taskId: "task-002" }, tmpDir);
    transitionTask(AGENT_ID, "task-002", "completing", tmpDir);

    const active = listTasksByStatus(AGENT_ID, ["active"], tmpDir);
    expect(active).toHaveLength(1);
    expect(active[0]?.taskId).toBe("task-001");

    const completing = listTasksByStatus(AGENT_ID, ["completing"], tmpDir);
    expect(completing).toHaveLength(1);
    expect(completing[0]?.taskId).toBe("task-002");

    const both = listTasksByStatus(AGENT_ID, ["active", "completing"], tmpDir);
    expect(both).toHaveLength(2);
  });
});
