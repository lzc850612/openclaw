import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "../config/types.openclaw.js";

export const WELLKNOWN_PATH = "/.well-known/openclaw.json";
export const A2A_PROTOCOL_VERSION = "1.0";
export const A2A_CAPABILITY = "a2a/1.0";

export type WellKnownAgent = {
  id: string;
  capabilities: string[];
};

export type WellKnownResponse = {
  version: string;
  instanceUrl: string;
  agents: WellKnownAgent[];
};

/**
 * Build the well-known response from config.
 * Returns null when federation is disabled or publicUrl is not set — in that
 * case the caller should respond with 404.
 */
export function buildWellKnownResponse(cfg: OpenClawConfig): WellKnownResponse | null {
  if (!cfg.federation?.enabled) {
    return null;
  }
  const instanceUrl = cfg.federation.publicUrl;
  if (!instanceUrl) {
    return null;
  }
  const agentList = cfg.agents?.list ?? [];
  return {
    version: A2A_PROTOCOL_VERSION,
    instanceUrl,
    agents: agentList.map((a) => ({ id: a.id, capabilities: [A2A_CAPABILITY] })),
  };
}

/**
 * HTTP handler for GET /.well-known/openclaw.json.
 * Returns false for any path that is not the well-known URL (so the caller
 * can continue its dispatch chain).
 */
export async function handleWellKnownRequest(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: OpenClawConfig,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== WELLKNOWN_PATH) {
    return false;
  }

  const body = buildWellKnownResponse(cfg);
  if (!body) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not Found");
    return true;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.end(JSON.stringify(body));
  return true;
}
