import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { A2A_MESSAGE_PATH, handleA2aMessageRequest } from "./gateway-handler.js";

const FEDERATION_ENABLED: OpenClawConfig = {
  federation: { enabled: true, publicUrl: "http://localhost:18789" },
};

const FEDERATION_DISABLED: OpenClawConfig = {
  federation: { enabled: false },
};

const VALID_BODY = {
  taskId: "task-1",
  messageId: "msg-1",
  fromInstanceUrl: "http://peer.example.com",
  fromAgentId: "agent-b",
  type: "task.request",
  content: "Please book a meeting",
};

const noopLog = {
  debug: vi.fn(),
};

function makeReq(opts: { path: string; method?: string; body?: unknown }): IncomingMessage {
  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : "";
  const readable = Readable.from([bodyStr]) as unknown as IncomingMessage;
  readable.method = opts.method ?? "POST";
  readable.url = opts.path;
  readable.headers = { "content-type": "application/json" };
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleA2aMessageRequest", () => {
  // --- Path routing ---

  test("returns false for paths other than /a2a/message", async () => {
    const req = makeReq({ path: "/api/other" });
    const { res } = makeRes();
    const result = await handleA2aMessageRequest(req, res, FEDERATION_ENABLED, noopLog);
    expect(result).toBe(false);
  });

  // --- Federation gate ---

  test("returns 404 when federation is disabled", async () => {
    const req = makeReq({ path: A2A_MESSAGE_PATH });
    const { res, statusCode } = makeRes();
    const result = await handleA2aMessageRequest(req, res, FEDERATION_DISABLED, noopLog);
    expect(result).toBe(true);
    expect(statusCode.value).toBe(404);
  });

  test("returns 404 when federation config is absent", async () => {
    const req = makeReq({ path: A2A_MESSAGE_PATH });
    const { res, statusCode } = makeRes();
    const result = await handleA2aMessageRequest(req, res, {}, noopLog);
    expect(result).toBe(true);
    expect(statusCode.value).toBe(404);
  });

  // --- Method check ---

  test("returns 405 for non-POST methods", async () => {
    const req = makeReq({ path: A2A_MESSAGE_PATH, method: "GET" });
    const { res, statusCode } = makeRes();
    const result = await handleA2aMessageRequest(req, res, FEDERATION_ENABLED, noopLog);
    expect(result).toBe(true);
    expect(statusCode.value).toBe(405);
  });

  // --- Field validation ---

  test("returns 400 when body is not a JSON object", async () => {
    const req = makeReq({ path: A2A_MESSAGE_PATH, body: ["not", "an", "object"] });
    const { res, statusCode, body } = makeRes();
    await handleA2aMessageRequest(req, res, FEDERATION_ENABLED, noopLog);
    expect(statusCode.value).toBe(400);
    expect(JSON.parse(body.value).ok).toBe(false);
  });

  test.each(["taskId", "messageId", "fromInstanceUrl", "fromAgentId", "type", "content"])(
    "returns 400 when required field '%s' is missing",
    async (field) => {
      const incomplete = { ...VALID_BODY, [field]: undefined };
      const req = makeReq({ path: A2A_MESSAGE_PATH, body: incomplete });
      const { res, statusCode, body } = makeRes();
      await handleA2aMessageRequest(req, res, FEDERATION_ENABLED, noopLog);
      expect(statusCode.value).toBe(400);
      const parsed = JSON.parse(body.value) as { ok: boolean; error: string };
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain(field);
    },
  );

  test("returns 400 when a required field is an empty string", async () => {
    const req = makeReq({ path: A2A_MESSAGE_PATH, body: { ...VALID_BODY, taskId: "   " } });
    const { res, statusCode } = makeRes();
    await handleA2aMessageRequest(req, res, FEDERATION_ENABLED, noopLog);
    expect(statusCode.value).toBe(400);
  });

  // --- Success ---

  test("returns 202 with messageId on a valid request", async () => {
    const req = makeReq({ path: A2A_MESSAGE_PATH, body: VALID_BODY });
    const { res, statusCode, body } = makeRes();
    const result = await handleA2aMessageRequest(req, res, FEDERATION_ENABLED, noopLog);
    expect(result).toBe(true);
    expect(statusCode.value).toBe(202);
    const parsed = JSON.parse(body.value) as { ok: boolean; messageId: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.messageId).toBe(VALID_BODY.messageId);
  });

  test("logs inbound message at debug level with taskId, fromAgent, and type", async () => {
    const debugSpy = vi.fn();
    const req = makeReq({ path: A2A_MESSAGE_PATH, body: VALID_BODY });
    const { res } = makeRes();
    await handleA2aMessageRequest(req, res, FEDERATION_ENABLED, { debug: debugSpy });
    expect(debugSpy).toHaveBeenCalledOnce();
    const [, meta] = debugSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(meta.taskId).toBe(VALID_BODY.taskId);
    expect(meta.type).toBe(VALID_BODY.type);
    expect(String(meta.fromAgent)).toContain(VALID_BODY.fromAgentId);
  });

  // --- Protocol message types (HTTP layer) ---

  test("returns 202 for a completing-type message", async () => {
    const body = { ...VALID_BODY, type: "completing" };
    const req = makeReq({ path: A2A_MESSAGE_PATH, body });
    const { res, statusCode } = makeRes();
    const result = await handleA2aMessageRequest(req, res, FEDERATION_ENABLED, noopLog);
    expect(result).toBe(true);
    expect(statusCode.value).toBe(202);
  });

  test("returns 202 for a completed-type message", async () => {
    const body = { ...VALID_BODY, type: "completed" };
    const req = makeReq({ path: A2A_MESSAGE_PATH, body });
    const { res, statusCode } = makeRes();
    const result = await handleA2aMessageRequest(req, res, FEDERATION_ENABLED, noopLog);
    expect(result).toBe(true);
    expect(statusCode.value).toBe(202);
  });

  test("echoes the messageId in the 202 response body for completing messages", async () => {
    const body = { ...VALID_BODY, messageId: "completing-msg-1", type: "completing" };
    const req = makeReq({ path: A2A_MESSAGE_PATH, body });
    const { res, body: resBody } = makeRes();
    await handleA2aMessageRequest(req, res, FEDERATION_ENABLED, noopLog);
    const parsed = JSON.parse(resBody.value) as { ok: boolean; messageId: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.messageId).toBe("completing-msg-1");
  });
});
