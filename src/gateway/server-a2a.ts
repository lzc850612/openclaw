import type { IncomingMessage, ServerResponse } from "node:http";
import { handleA2aMessageRequest } from "../a2a/gateway-handler.js";
import { handleWellKnownRequest } from "../a2a/gateway-wellknown.js";
import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

export type A2ARequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

const log = createSubsystemLogger("a2a");

/**
 * Creates the A2A HTTP request handler.
 * Owns the /.well-known/openclaw.json and /a2a/* URL namespaces.
 * Returns false for any path it does not own so the caller continues its chain.
 */
export function createA2aRequestHandler(): A2ARequestHandler {
  return async (req, res) => {
    const cfg = loadConfig();
    if (await handleWellKnownRequest(req, res, cfg)) {
      return true;
    }
    if (await handleA2aMessageRequest(req, res, cfg, log)) {
      return true;
    }
    return false;
  };
}
