import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, test, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  A2A_CAPABILITY,
  A2A_PROTOCOL_VERSION,
  buildWellKnownResponse,
  handleWellKnownRequest,
  WELLKNOWN_PATH,
} from "./gateway-wellknown.js";

// --- Unit tests: buildWellKnownResponse ---

describe("buildWellKnownResponse", () => {
  test("returns null when federation is not configured", () => {
    const cfg: OpenClawConfig = {};
    expect(buildWellKnownResponse(cfg)).toBeNull();
  });

  test("returns null when federation.enabled is false", () => {
    const cfg: OpenClawConfig = {
      federation: { enabled: false, publicUrl: "http://localhost:18789" },
    };
    expect(buildWellKnownResponse(cfg)).toBeNull();
  });

  test("returns null when federation.enabled is true but publicUrl is missing", () => {
    const cfg: OpenClawConfig = { federation: { enabled: true } };
    expect(buildWellKnownResponse(cfg)).toBeNull();
  });

  test("returns well-known response with correct version and instanceUrl", () => {
    const cfg: OpenClawConfig = {
      federation: { enabled: true, publicUrl: "http://localhost:18789" },
    };
    const result = buildWellKnownResponse(cfg);
    expect(result).not.toBeNull();
    expect(result?.version).toBe(A2A_PROTOCOL_VERSION);
    expect(result?.instanceUrl).toBe("http://localhost:18789");
  });

  test("includes all configured agents with a2a/1.0 capability", () => {
    const cfg: OpenClawConfig = {
      federation: { enabled: true, publicUrl: "https://agent.example.com" },
      agents: {
        list: [
          { id: "agent-a", model: "gpt-4o" },
          { id: "agent-b", model: "gpt-4o" },
        ],
      },
    };
    const result = buildWellKnownResponse(cfg);
    expect(result?.agents).toHaveLength(2);
    expect(result?.agents[0]).toEqual({ id: "agent-a", capabilities: [A2A_CAPABILITY] });
    expect(result?.agents[1]).toEqual({ id: "agent-b", capabilities: [A2A_CAPABILITY] });
  });

  test("returns default agent when no agents are configured", () => {
    const cfg: OpenClawConfig = {
      federation: { enabled: true, publicUrl: "http://localhost:18789" },
    };
    const result = buildWellKnownResponse(cfg);
    expect(result?.agents).toHaveLength(1);
    expect(result?.agents[0]?.capabilities).toContain(A2A_CAPABILITY);
  });
});

// --- Unit tests: handleWellKnownRequest ---

function makeReq(path: string): IncomingMessage {
  return { url: path, method: "GET", headers: {} } as IncomingMessage;
}

function makeRes(): {
  res: ServerResponse;
  statusCode: { value: number };
  headers: Record<string, string>;
  body: { value: string };
} {
  const statusCode = { value: 200 };
  const headers: Record<string, string> = {};
  const body = { value: "" };
  const res = {
    get statusCode() {
      return statusCode.value;
    },
    set statusCode(v: number) {
      statusCode.value = v;
    },
    setHeader: vi.fn((name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    }),
    end: vi.fn((chunk?: string) => {
      body.value = chunk ?? "";
    }),
  } as unknown as ServerResponse;
  return { res, statusCode, headers, body };
}

describe("handleWellKnownRequest", () => {
  test("returns false for paths other than /.well-known/openclaw.json", async () => {
    const req = makeReq("/api/other");
    const { res } = makeRes();
    const cfg: OpenClawConfig = {
      federation: { enabled: true, publicUrl: "http://localhost:18789" },
    };
    const result = await handleWellKnownRequest(req, res, cfg);
    expect(result).toBe(false);
  });

  test("returns 404 when federation is disabled", async () => {
    const req = makeReq(WELLKNOWN_PATH);
    const { res, statusCode } = makeRes();
    const cfg: OpenClawConfig = { federation: { enabled: false } };
    const result = await handleWellKnownRequest(req, res, cfg);
    expect(result).toBe(true);
    expect(statusCode.value).toBe(404);
  });

  test("returns 404 when federation.publicUrl is not set", async () => {
    const req = makeReq(WELLKNOWN_PATH);
    const { res, statusCode } = makeRes();
    const cfg: OpenClawConfig = { federation: { enabled: true } };
    const result = await handleWellKnownRequest(req, res, cfg);
    expect(result).toBe(true);
    expect(statusCode.value).toBe(404);
  });

  test("returns 200 with JSON body when federation is enabled", async () => {
    const req = makeReq(WELLKNOWN_PATH);
    const { res, statusCode, headers, body } = makeRes();
    const cfg: OpenClawConfig = {
      federation: { enabled: true, publicUrl: "http://localhost:18789" },
      agents: { list: [{ id: "my-agent", model: "claude-sonnet-4-6" }] },
    };
    const result = await handleWellKnownRequest(req, res, cfg);
    expect(result).toBe(true);
    expect(statusCode.value).toBe(200);
    expect(headers["content-type"]).toContain("application/json");
    const parsed = JSON.parse(body.value) as {
      version: string;
      instanceUrl: string;
      agents: { id: string; capabilities: string[] }[];
    };
    expect(parsed.version).toBe(A2A_PROTOCOL_VERSION);
    expect(parsed.instanceUrl).toBe("http://localhost:18789");
    expect(parsed.agents).toEqual([{ id: "my-agent", capabilities: [A2A_CAPABILITY] }]);
  });
});
