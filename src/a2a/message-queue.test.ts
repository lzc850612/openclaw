import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { OutboundA2AMessage } from "./message-queue.js";
import { sendA2aMessage } from "./message-queue.js";

const PEER_URL = "http://peer.example.com";

const VALID_MESSAGE: OutboundA2AMessage = {
  taskId: "task-1",
  messageId: "msg-1",
  fromInstanceUrl: "http://localhost:18789",
  fromAgentId: "agent-a",
  type: "task.request",
  content: "Book a meeting",
};

const noopLog = { debug: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetchOk(status = 202) {
  vi.mocked(fetch).mockResolvedValue({ ok: status >= 200 && status < 300, status } as Response);
}

function mockFetchError(err: Error) {
  vi.mocked(fetch).mockRejectedValue(err);
}

describe("sendA2aMessage", () => {
  test("POSTs to the peer /a2a/message endpoint", async () => {
    mockFetchOk();
    await sendA2aMessage({ peerInstanceUrl: PEER_URL, message: VALID_MESSAGE, log: noopLog });
    expect(fetch).toHaveBeenCalledWith(
      `${PEER_URL}/a2a/message`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("strips trailing slash from peerInstanceUrl", async () => {
    mockFetchOk();
    await sendA2aMessage({
      peerInstanceUrl: `${PEER_URL}/`,
      message: VALID_MESSAGE,
      log: noopLog,
    });
    expect(fetch).toHaveBeenCalledWith(`${PEER_URL}/a2a/message`, expect.anything());
  });

  test("sends message body as JSON", async () => {
    mockFetchOk();
    await sendA2aMessage({ peerInstanceUrl: PEER_URL, message: VALID_MESSAGE, log: noopLog });
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toMatchObject(VALID_MESSAGE);
  });

  test("returns ok:true on a 2xx response", async () => {
    mockFetchOk(202);
    const result = await sendA2aMessage({
      peerInstanceUrl: PEER_URL,
      message: VALID_MESSAGE,
      log: noopLog,
    });
    expect(result.ok).toBe(true);
  });

  test("returns ok:false with error when peer responds with non-2xx", async () => {
    mockFetchOk(500);
    const result = await sendA2aMessage({
      peerInstanceUrl: PEER_URL,
      message: VALID_MESSAGE,
      log: noopLog,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("HTTP 500");
    }
  });

  test("returns ok:false with error on network failure", async () => {
    mockFetchError(new Error("ECONNREFUSED"));
    const result = await sendA2aMessage({
      peerInstanceUrl: PEER_URL,
      message: VALID_MESSAGE,
      log: noopLog,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("send failed");
    }
  });

  test("logs debug on success", async () => {
    const debugSpy = vi.fn();
    mockFetchOk();
    await sendA2aMessage({
      peerInstanceUrl: PEER_URL,
      message: VALID_MESSAGE,
      log: { debug: debugSpy, warn: vi.fn() },
    });
    expect(debugSpy).toHaveBeenCalledOnce();
  });

  test("logs warn on non-2xx response", async () => {
    const warnSpy = vi.fn();
    mockFetchOk(503);
    await sendA2aMessage({
      peerInstanceUrl: PEER_URL,
      message: VALID_MESSAGE,
      log: { debug: vi.fn(), warn: warnSpy },
    });
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
