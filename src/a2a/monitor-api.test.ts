import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { handleMonitorRequest, MONITOR_TASKS_PATH, MONITOR_UI_PATH } from "./monitor-api.js";
import { createTask, appendMessage } from "./task-store.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FEDERATION_ENABLED: OpenClawConfig = {
  federation: { enabled: true, publicUrl: "http://localhost:18789" },
};
const FEDERATION_DISABLED: OpenClawConfig = {
  federation: { enabled: false },
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-monitor-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function makeReq(opts: { path: string; method?: string }): IncomingMessage {
  const readable = Readable.from([]) as unknown as IncomingMessage;
  readable.method = opts.method ?? "GET";
  readable.url = opts.path;
  readable.headers = {};
  return readable;
}

function makeRes(): {
  res: ServerResponse;
  statusCode: { value: number };
  body: { value: string };
} {
  const statusCode = { value: 200 };
  const body = { value: "" };
  const res = {
    get statusCode() {
      return statusCode.value;
    },
    set statusCode(v: number) {
      statusCode.value = v;
    },
    setHeader: vi.fn(),
    end: vi.fn((chunk?: string) => {
      body.value = chunk ?? "";
    }),
  } as unknown as ServerResponse;
  return { res, statusCode, body };
}

// ---------------------------------------------------------------------------
// Task factory
// ---------------------------------------------------------------------------

function seedTask(taskId: string, agentId = "agent-a") {
  return createTask(
    {
      taskId,
      agentId,
      role: "initiator",
      remoteInstanceUrl: "http://peer.example.com",
      remoteAgentId: "agent-b",
      goal: "book a meeting",
      status: "active",
    },
    tmpDir,
  );
}

// ---------------------------------------------------------------------------
// Path routing
// ---------------------------------------------------------------------------

describe("handleMonitorRequest path routing", () => {
  test("returns false for unrelated paths", () => {
    const req = makeReq({ path: "/api/other" });
    const { res } = makeRes();
    expect(handleMonitorRequest(req, res, FEDERATION_ENABLED, tmpDir)).toBe(false);
  });

  test("returns false for /a2a/message (owned by gateway-handler)", () => {
    const req = makeReq({ path: "/a2a/message" });
    const { res } = makeRes();
    expect(handleMonitorRequest(req, res, FEDERATION_ENABLED, tmpDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /a2a/tasks
// ---------------------------------------------------------------------------

describe("GET /a2a/tasks", () => {
  test("returns 404 when federation is disabled", () => {
    const req = makeReq({ path: MONITOR_TASKS_PATH });
    const { res, statusCode } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_DISABLED, tmpDir);
    expect(statusCode.value).toBe(404);
  });

  test("returns 405 for non-GET methods", () => {
    const req = makeReq({ path: MONITOR_TASKS_PATH, method: "POST" });
    const { res, statusCode } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_ENABLED, tmpDir);
    expect(statusCode.value).toBe(405);
  });

  test("returns empty array when no tasks exist", () => {
    const req = makeReq({ path: MONITOR_TASKS_PATH });
    const { res, body } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_ENABLED, tmpDir);
    expect(JSON.parse(body.value)).toEqual([]);
  });

  test("returns summaries for all tasks", () => {
    seedTask("task-001");
    seedTask("task-002");
    const req = makeReq({ path: MONITOR_TASKS_PATH });
    const { res, body } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_ENABLED, tmpDir);
    const parsed = JSON.parse(body.value) as { taskId: string }[];
    const ids = parsed.map((t) => t.taskId).toSorted();
    expect(ids).toEqual(["task-001", "task-002"]);
  });

  test("summary includes expected fields", () => {
    seedTask("task-xyz");
    const req = makeReq({ path: MONITOR_TASKS_PATH });
    const { res, body } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_ENABLED, tmpDir);
    const [summary] = JSON.parse(body.value) as Record<string, unknown>[];
    expect(summary).toMatchObject({
      taskId: "task-xyz",
      status: "active",
      role: "initiator",
      goal: "book a meeting",
      messageCount: 0,
    });
    expect(typeof summary?.lastActivityAt).toBe("number");
  });

  test("tasks sorted by lastActivityAt descending", () => {
    seedTask("task-001");
    // small delay so updatedAtMs differs
    seedTask("task-002");
    const req = makeReq({ path: MONITOR_TASKS_PATH });
    const { res, body } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_ENABLED, tmpDir);
    const parsed = JSON.parse(body.value) as { taskId: string; lastActivityAt: number }[];
    // task-002 created after task-001, should come first
    expect(parsed[0]?.lastActivityAt).toBeGreaterThanOrEqual(parsed[1]?.lastActivityAt ?? 0);
  });
});

// ---------------------------------------------------------------------------
// GET /a2a/tasks/:taskId
// ---------------------------------------------------------------------------

describe("GET /a2a/tasks/:taskId", () => {
  test("returns 404 when federation is disabled", () => {
    const req = makeReq({ path: "/a2a/tasks/task-001" });
    const { res, statusCode } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_DISABLED, tmpDir);
    expect(statusCode.value).toBe(404);
  });

  test("returns 404 when task does not exist", () => {
    const req = makeReq({ path: "/a2a/tasks/nonexistent" });
    const { res, statusCode, body } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_ENABLED, tmpDir);
    expect(statusCode.value).toBe(404);
    expect(JSON.parse(body.value).ok).toBe(false);
  });

  test("returns 200 with full task for existing task", () => {
    seedTask("task-abc");
    const req = makeReq({ path: "/a2a/tasks/task-abc" });
    const { res, statusCode, body } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_ENABLED, tmpDir);
    expect(statusCode.value).toBe(200);
    const parsed = JSON.parse(body.value) as { taskId: string; messages: unknown[] };
    expect(parsed.taskId).toBe("task-abc");
    expect(Array.isArray(parsed.messages)).toBe(true);
  });

  test("returns 405 for non-GET method", () => {
    seedTask("task-abc");
    const req = makeReq({ path: "/a2a/tasks/task-abc", method: "DELETE" });
    const { res, statusCode } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_ENABLED, tmpDir);
    expect(statusCode.value).toBe(405);
  });

  test("derives message direction from fromInstanceUrl", () => {
    seedTask("task-dir");
    appendMessage(
      "agent-a",
      "task-dir",
      {
        messageId: "msg-out",
        fromInstanceUrl: "http://localhost:18789", // matches publicUrl → out
        fromAgentId: "agent-a",
        type: "task.request",
        content: "hello",
        receivedAtMs: Date.now(),
      },
      tmpDir,
    );
    appendMessage(
      "agent-a",
      "task-dir",
      {
        messageId: "msg-in",
        fromInstanceUrl: "http://peer.example.com", // does not match → in
        fromAgentId: "agent-b",
        type: "message",
        content: "world",
        receivedAtMs: Date.now(),
      },
      tmpDir,
    );
    const req = makeReq({ path: "/a2a/tasks/task-dir" });
    const { res, body } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_ENABLED, tmpDir);
    const parsed = JSON.parse(body.value) as {
      messages: { messageId: string; direction: string }[];
    };
    const outMsg = parsed.messages.find((m) => m.messageId === "msg-out");
    const inMsg = parsed.messages.find((m) => m.messageId === "msg-in");
    expect(outMsg?.direction).toBe("out");
    expect(inMsg?.direction).toBe("in");
  });
});

// ---------------------------------------------------------------------------
// GET /a2a/monitor (dashboard HTML)
// ---------------------------------------------------------------------------

describe("GET /a2a/monitor", () => {
  test("returns 404 when federation is disabled", () => {
    const req = makeReq({ path: MONITOR_UI_PATH });
    const { res, statusCode } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_DISABLED, tmpDir);
    expect(statusCode.value).toBe(404);
  });

  test("returns 200 HTML when federation is enabled", () => {
    const req = makeReq({ path: MONITOR_UI_PATH });
    const { res, statusCode, body } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_ENABLED, tmpDir);
    expect(statusCode.value).toBe(200);
    expect(body.value).toContain("<!DOCTYPE html>");
    expect(body.value).toContain("A2A Monitor");
  });

  test("HTML contains task list and thread panel elements", () => {
    const req = makeReq({ path: MONITOR_UI_PATH });
    const { res, body } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_ENABLED, tmpDir);
    expect(body.value).toContain("taskList");
    expect(body.value).toContain("/a2a/tasks");
  });

  test("returns 405 for non-GET method", () => {
    const req = makeReq({ path: MONITOR_UI_PATH, method: "POST" });
    const { res, statusCode } = makeRes();
    handleMonitorRequest(req, res, FEDERATION_ENABLED, tmpDir);
    expect(statusCode.value).toBe(405);
  });
});
