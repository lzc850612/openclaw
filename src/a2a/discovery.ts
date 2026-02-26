import { z } from "zod";
import { A2A_CAPABILITY, WELLKNOWN_PATH } from "./gateway-wellknown.js";

const WellKnownAgentSchema = z.object({
  id: z.string(),
  capabilities: z.array(z.string()),
});

const WellKnownSchema = z.object({
  version: z.string(),
  instanceUrl: z.string(),
  agents: z.array(WellKnownAgentSchema),
});

type WellKnownResponse = z.infer<typeof WellKnownSchema>;

type CacheEntry = {
  data: WellKnownResponse;
  expiresAt: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Module-level cache; cleared between tests via clearDiscoveryCache().
const cache = new Map<string, CacheEntry>();

export type PeerDiscoveryResult =
  | { ok: true; instanceUrl: string; agentCapabilities: string[] }
  | { ok: false; error: string };

/**
 * Discover a peer agent by fetching its gateway's well-known descriptor.
 * Results are cached for 5 minutes to avoid redundant fetches.
 * Returns an error result (never throws) so callers can fail gracefully.
 */
export async function discoverPeer(
  peerInstanceUrl: string,
  peerAgentId: string,
): Promise<PeerDiscoveryResult> {
  const baseUrl = peerInstanceUrl.replace(/\/+$/, "");

  const cached = cache.get(baseUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return resolveAgent(cached.data, peerAgentId);
  }

  const wellKnownUrl = `${baseUrl}${WELLKNOWN_PATH}`;
  let raw: unknown;
  try {
    const resp = await fetch(wellKnownUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      return { ok: false, error: `peer well-known returned HTTP ${resp.status}` };
    }
    raw = await resp.json();
  } catch (err) {
    return { ok: false, error: `peer well-known fetch failed: ${String(err)}` };
  }

  const parsed = WellKnownSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: `peer well-known schema invalid: ${parsed.error.message}`,
    };
  }

  cache.set(baseUrl, { data: parsed.data, expiresAt: Date.now() + CACHE_TTL_MS });
  return resolveAgent(parsed.data, peerAgentId);
}

function resolveAgent(data: WellKnownResponse, agentId: string): PeerDiscoveryResult {
  const agent = data.agents.find((a) => a.id === agentId);
  if (!agent) {
    return { ok: false, error: `peer has no agent with id "${agentId}"` };
  }
  if (!agent.capabilities.includes(A2A_CAPABILITY)) {
    return {
      ok: false,
      error: `peer agent "${agentId}" does not support ${A2A_CAPABILITY}`,
    };
  }
  return { ok: true, instanceUrl: data.instanceUrl, agentCapabilities: agent.capabilities };
}

/** Clear the discovery cache. Used in tests to reset state between cases. */
export function clearDiscoveryCache(): void {
  cache.clear();
}
