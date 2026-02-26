import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { readJsonBodyWithLimit } from "../infra/http-body.js";

export const A2A_MESSAGE_PATH = "/a2a/message";
const MAX_BODY_BYTES = 1_000_000; // 1 MB

export type InboundA2AMessage = {
  taskId: string;
  messageId: string;
  fromInstanceUrl: string;
  fromAgentId: string;
  type: string;
  content: string;
};

type ValidationResult = { ok: true; message: InboundA2AMessage } | { ok: false; error: string };

const REQUIRED_FIELDS: readonly string[] = [
  "taskId",
  "messageId",
  "fromInstanceUrl",
  "fromAgentId",
  "type",
  "content",
];

function validateInboundMessage(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const obj = raw as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (typeof obj[field] !== "string" || !obj[field].trim()) {
      return { ok: false, error: "missing or empty required field: " + field };
    }
  }
  return {
    ok: true,
    message: {
      taskId: (obj.taskId as string).trim(),
      messageId: (obj.messageId as string).trim(),
      fromInstanceUrl: (obj.fromInstanceUrl as string).trim(),
      fromAgentId: (obj.fromAgentId as string).trim(),
      type: (obj.type as string).trim(),
      content: (obj.content as string).trim(),
    },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/**
 * HTTP handler for POST /a2a/message.
 * Accepts inbound A2A messages from peer gateways.
 * No auth in Phase 2 — auth is added in Phase 10.
 */
export async function handleA2aMessageRequest(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: OpenClawConfig,
  log: { debug: (message: string, meta?: Record<string, unknown>) => void },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== A2A_MESSAGE_PATH) {
    return false;
  }

  if (!cfg.federation?.enabled) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not Found");
    return true;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }

  const bodyResult = await readJsonBodyWithLimit(req, {
    maxBytes: MAX_BODY_BYTES,
    emptyObjectOnEmpty: false,
  });
  if (!bodyResult.ok) {
    const status =
      bodyResult.code === "PAYLOAD_TOO_LARGE"
        ? 413
        : bodyResult.code === "REQUEST_BODY_TIMEOUT"
          ? 408
          : 400;
    sendJson(res, status, { ok: false, error: bodyResult.error });
    return true;
  }

  const validated = validateInboundMessage(bodyResult.value);
  if (!validated.ok) {
    sendJson(res, 400, { ok: false, error: validated.error });
    return true;
  }

  const msg = validated.message;
  log.debug("inbound a2a message", {
    taskId: msg.taskId,
    fromAgent: `${msg.fromAgentId}@${msg.fromInstanceUrl}`,
    type: msg.type,
  });

  sendJson(res, 202, { ok: true, messageId: msg.messageId });
  return true;
}
