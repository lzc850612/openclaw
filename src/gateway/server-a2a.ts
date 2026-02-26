import type { IncomingMessage, ServerResponse } from "node:http";
import { handleWellKnownRequest } from "../a2a/gateway-wellknown.js";
import { loadConfig } from "../config/config.js";

export type A2ARequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

/**
 * Creates the A2A HTTP request handler.
 * Handles all routes under the /.well-known/openclaw.json and /a2a/* namespaces.
 * Returns false for any path it does not own (so the caller continues its chain).
 */
export function createA2aRequestHandler(): A2ARequestHandler {
  return async (req, res) => {
    const cfg = loadConfig();
    if (await handleWellKnownRequest(req, res, cfg)) {
      return true;
    }
    return false;
  };
}
