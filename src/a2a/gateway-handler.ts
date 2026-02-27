import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CliDeps } from "../cli/deps.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { readJsonBodyWithLimit } from "../infra/http-body.js";
import { buildA2AMessageHeader } from "./agent-prompt.js";
import { runA2AAgentTurn } from "./agent-turn.js";
import { dispatchCompletionCallback, dispatchParticipantNotification } from "./callbacks.js";
import { enqueueAndSend } from "./message-queue.js";
import { buildA2ASessionKey } from "./session-keys.js";
import { appendMessage, createTask, loadTask, transitionTask } from "./task-store.js";

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

type HandlerLog = {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
};

async function dispatchInboundTurn(
  msg: InboundA2AMessage,
  cfg: OpenClawConfig,
  log: HandlerLog,
  _deps: CliDeps,
): Promise<void> {
  const { resolveDefaultAgentId } = await import("../agents/agent-scope.js");
  const agentId = resolveDefaultAgentId(cfg);
  const localInstanceUrl = cfg.federation?.publicUrl ?? "";

  // Auto-create task as responder when first inbound message arrives.
  if (!loadTask(agentId, msg.taskId)) {
    try {
      createTask({
        taskId: msg.taskId,
        agentId,
        role: "responder",
        remoteInstanceUrl: msg.fromInstanceUrl,
        remoteAgentId: msg.fromAgentId,
        goal: msg.content,
        status: "active",
      });
    } catch (err) {
      log.debug("a2a: could not auto-create responder task", {
        taskId: msg.taskId,
        error: String(err),
      });
    }
  }

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
    log.debug("a2a: could not append message to task store", {
      taskId: msg.taskId,
      error: String(err),
    });
  }

  // Route by protocol message type.
  if (msg.type === "completed") {
    // Remote side confirmed close — transition local task to closed.
    try {
      transitionTask(agentId, msg.taskId, "closed");
      log.debug("a2a: task closed on inbound completed", { taskId: msg.taskId });
    } catch (err) {
      log.debug("a2a: could not close task on completed", {
        taskId: msg.taskId,
        error: String(err),
      });
    }
    // Fire completion callback so the agent can summarise the outcome for the human.
    const closedTaskOnCompleted = loadTask(agentId, msg.taskId);
    if (closedTaskOnCompleted) {
      void dispatchCompletionCallback({ cfg, agentId, task: closedTaskOnCompleted });
    }
    return;
  }

  if (msg.type === "completing") {
    // Remote side is done — check if we are already closed (simultaneous close edge case).
    const task = loadTask(agentId, msg.taskId);
    if (task?.status === "closed") {
      // Already closed: re-send completed (idempotent), no state change.
      log.debug("a2a: received completing on closed task, re-sending completed", {
        taskId: msg.taskId,
      });
      void sendCompletedReply(agentId, msg, localInstanceUrl, cfg, log);
      return;
    }

    // Dispatch agent turn so the agent can do its final processing.
    await runAgentTurn(agentId, msg, cfg, log);

    // After the turn: send completed and close the task.
    void sendCompletedReply(agentId, msg, localInstanceUrl, cfg, log);
    try {
      transitionTask(agentId, msg.taskId, "closed");
      log.debug("a2a: task closed after processing completing", { taskId: msg.taskId });
    } catch (err) {
      log.debug("a2a: could not close task after completing", {
        taskId: msg.taskId,
        error: String(err),
      });
    }
    // Notify participant that their task has closed.
    const closedTaskOnCompleting = loadTask(agentId, msg.taskId);
    if (closedTaskOnCompleting) {
      void dispatchParticipantNotification({ cfg, agentId, task: closedTaskOnCompleting });
    }
    return;
  }

  // Regular message — dispatch agent turn.
  await runAgentTurn(agentId, msg, cfg, log);
}

/** Send { type: "completed" } back to the peer that sent "completing". */
async function sendCompletedReply(
  agentId: string,
  msg: InboundA2AMessage,
  localInstanceUrl: string,
  _cfg: OpenClawConfig,
  log: HandlerLog,
): Promise<void> {
  if (!localInstanceUrl) {
    log.debug("a2a: cannot send completed reply — federation.publicUrl not set", {
      taskId: msg.taskId,
    });
    return;
  }
  const messageId = randomUUID();
  // enqueueAndSend requires both debug and warn; provide a no-op warn if missing.
  const sendLog = { debug: log.debug, warn: log.warn ?? log.debug };
  const result = await enqueueAndSend({
    agentId,
    peerInstanceUrl: msg.fromInstanceUrl,
    message: {
      taskId: msg.taskId,
      messageId,
      fromInstanceUrl: localInstanceUrl,
      fromAgentId: agentId,
      type: "completed",
      content: "",
    },
    log: sendLog,
  });
  if (!result.ok) {
    log.debug("a2a: completed reply send failed", { taskId: msg.taskId, error: result.error });
  } else {
    log.debug("a2a: completed reply sent", { taskId: msg.taskId, messageId });
  }
}

/** Dispatch an isolated agent reasoning turn for the inbound message. */
async function runAgentTurn(
  agentId: string,
  msg: InboundA2AMessage,
  cfg: OpenClawConfig,
  log: HandlerLog,
): Promise<void> {
  const sessionKey = buildA2ASessionKey(agentId, msg.taskId);
  const task = loadTask(agentId, msg.taskId);
  if (!task) {
    log.debug("a2a: skipping agent turn — task not found", { taskId: msg.taskId });
    return;
  }

  // Determine round number from the number of messages already in the transcript.
  const roundNumber = task.messages.length;

  // Prepend a trusted sender context header so the agent knows who sent the message.
  const header = buildA2AMessageHeader({
    fromAgentId: msg.fromAgentId,
    fromInstanceUrl: msg.fromInstanceUrl,
    taskId: msg.taskId,
    roundNumber,
  });
  const messageWithHeader = `${header}\n\n${msg.content}`;

  const result = await runA2AAgentTurn({
    cfg,
    agentId,
    task,
    message: messageWithHeader,
    sessionKey,
  });
  if (result.status === "error") {
    log.debug("a2a: agent turn failed", {
      taskId: msg.taskId,
      sessionKey,
      error: result.error,
    });
  }
}
