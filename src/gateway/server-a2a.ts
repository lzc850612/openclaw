import type { IncomingMessage, ServerResponse } from "node:http";
import { handleA2aMessageRequest } from "../a2a/gateway-handler.js";
import { handleWellKnownRequest } from "../a2a/gateway-wellknown.js";
import { handleMonitorRequest } from "../a2a/monitor-api.js";
import type { CliDeps } from "../cli/deps.js";
import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

export type A2ARequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

const log = createSubsystemLogger("a2a");

/**
 * Creates the A2A HTTP request handler.
 * Owns the /.well-known/openclaw.json, /a2a/message, /a2a/tasks, and
 * /a2a/monitor URL namespaces.
 * Returns false for any path it does not own so the caller continues its chain.
 */
export function createA2aRequestHandler(deps?: CliDeps): A2ARequestHandler {
  return async (req, res) => {
    const cfg = loadConfig();
    if (await handleWellKnownRequest(req, res, cfg)) {
      return true;
    }
    if (await handleA2aMessageRequest(req, res, cfg, log, deps)) {
      return true;
    }
    if (handleMonitorRequest(req, res, cfg)) {
      return true;
    }
    return false;
  };
}
