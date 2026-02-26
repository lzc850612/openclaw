import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearDiscoveryCache, discoverPeer } from "./discovery.js";
import { A2A_CAPABILITY } from "./gateway-wellknown.js";

const BASE_URL = "http://peer.example.com";
const AGENT_ID = "agent-a";

const VALID_WELL_KNOWN = {
  version: "1.0",
  instanceUrl: BASE_URL,
  agents: [{ id: AGENT_ID, capabilities: [A2A_CAPABILITY] }],
};

beforeEach(() => {
  clearDiscoveryCache();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetchSuccess(body: unknown, status = 200) {
  vi.mocked(fetch).mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function mockFetchFailure(err: Error) {
  vi.mocked(fetch).mockRejectedValue(err);
}

describe("discoverPeer", () => {
  test("returns error when fetch fails with a network error", async () => {
    mockFetchFailure(new Error("ECONNREFUSED"));
    const result = await discoverPeer(BASE_URL, AGENT_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("fetch failed");
    }
  });

  test("returns error when peer responds with non-200 status", async () => {
    mockFetchSuccess({}, 404);
    const result = await discoverPeer(BASE_URL, AGENT_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("HTTP 404");
    }
  });

  test("returns error when well-known response fails schema validation", async () => {
    mockFetchSuccess({ unexpected: true });
    const result = await discoverPeer(BASE_URL, AGENT_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("schema invalid");
    }
  });

  test("returns error when peer has no agent with the requested id", async () => {
    mockFetchSuccess({
      ...VALID_WELL_KNOWN,
      agents: [{ id: "other-agent", capabilities: [A2A_CAPABILITY] }],
    });
    const result = await discoverPeer(BASE_URL, AGENT_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(`no agent with id "${AGENT_ID}"`);
    }
  });

  test("returns error when peer agent does not declare a2a/1.0 capability", async () => {
    mockFetchSuccess({
      ...VALID_WELL_KNOWN,
      agents: [{ id: AGENT_ID, capabilities: ["other/1.0"] }],
    });
    const result = await discoverPeer(BASE_URL, AGENT_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("does not support");
    }
  });

  test("returns success with instanceUrl and capabilities when peer is reachable", async () => {
    mockFetchSuccess(VALID_WELL_KNOWN);
    const result = await discoverPeer(BASE_URL, AGENT_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.instanceUrl).toBe(BASE_URL);
      expect(result.agentCapabilities).toContain(A2A_CAPABILITY);
    }
  });

  test("uses cached result on second call without fetching again", async () => {
    mockFetchSuccess(VALID_WELL_KNOWN);
    const first = await discoverPeer(BASE_URL, AGENT_ID);
    const second = await discoverPeer(BASE_URL, AGENT_ID);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // fetch was only called once — second call used the cache
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("strips trailing slash from instanceUrl before fetching", async () => {
    mockFetchSuccess(VALID_WELL_KNOWN);
    await discoverPeer(`${BASE_URL}/`, AGENT_ID);
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/.well-known/openclaw.json`, expect.anything());
  });
});
