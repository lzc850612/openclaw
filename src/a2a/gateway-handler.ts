import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CliDeps } from "../cli/deps.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { runCronIsolatedAgentTurn } from "../cron/isolated-agent.js";
import type { CronJob } from "../cron/types.js";
import { readJsonBodyWithLimit } from "../infra/http-body.js";
import { buildA2ASessionKey } from "./session-keys.js";
import { appendMessage } from "./task-store.js";

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
 * Accepts inbound A2A messages from peer gateways, persists them to the task
 * store, then dispatches an isolated agent turn via runCronIsolatedAgentTurn.
 * No auth in Phase 2/3 — auth is added in Phase 10.
 */
export async function handleA2aMessageRequest(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: OpenClawConfig,
  log: { debug: (message: string, meta?: Record<string, unknown>) => void },
  deps?: CliDeps,
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

  // Acknowledge immediately; agent dispatch happens asynchronously below.
  sendJson(res, 202, { ok: true, messageId: msg.messageId });

  // Dispatch agent turn if we have deps and a matching task.
  // Failures are logged but must not affect the 202 already sent.
  if (deps) {
    void dispatchInboundTurn(msg, cfg, log, deps);
  }

  return true;
}

async function dispatchInboundTurn(
  msg: InboundA2AMessage,
  cfg: OpenClawConfig,
  log: { debug: (message: string, meta?: Record<string, unknown>) => void },
  deps: CliDeps,
): Promise<void> {
  // Determine which local agent owns this task.
  // The task file encodes the agentId; we look it up via the task store.
  // For now, resolve the default agent (same as hooks.ts pattern).
  const { resolveDefaultAgentId } = await import("../agents/agent-scope.js");
  const agentId = resolveDefaultAgentId(cfg);

  // Persist message to task store.
  const storedMsg = {
    messageId: msg.messageId,
    fromInstanceUrl: msg.fromInstanceUrl,
    fromAgentId: msg.fromAgentId,
    type: msg.type,
    content: msg.content,
    receivedAtMs: Date.now(),
  };

  try {
    appendMessage(agentId, msg.taskId, storedMsg);
  } catch (err) {
    // Task may not exist yet (initiator side) — still dispatch the agent turn.
    log.debug("a2a: could not append message to task store", {
      taskId: msg.taskId,
      error: String(err),
    });
  }

  const sessionKey = buildA2ASessionKey(agentId, msg.taskId);
  const jobId = randomUUID();
  const now = Date.now();
  const job: CronJob = {
    id: jobId,
    agentId,
    name: `a2a:${msg.taskId}`,
    enabled: true,
    createdAtMs: now,
    updatedAtMs: now,
    schedule: { kind: "at", at: new Date(now).toISOString() },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: {
      kind: "agentTurn",
      message: msg.content,
      allowUnsafeExternalContent: false,
    },
    state: { nextRunAtMs: now },
  };

  try {
    await runCronIsolatedAgentTurn({
      cfg,
      deps,
      job,
      message: msg.content,
      sessionKey,
      lane: "cron",
    });
  } catch (err) {
    log.debug("a2a: agent turn failed", {
      taskId: msg.taskId,
      sessionKey,
      error: String(err),
    });
  }
}
