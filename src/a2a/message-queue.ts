import { A2A_MESSAGE_PATH } from "./gateway-handler.js";

export type OutboundA2AMessage = {
  taskId: string;
  messageId: string;
  fromInstanceUrl: string;
  fromAgentId: string;
  type: string;
  content: string;
};

export type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Send an A2A message to a peer gateway via HTTP POST.
 *
 * Phase 2 stub — fire-and-forget with a single attempt, no persistence,
 * no retry. Phase 3 replaces this with a durable outbox queue with
 * exponential backoff via src/infra/retry.ts.
 */
export async function sendA2aMessage(params: {
  peerInstanceUrl: string;
  message: OutboundA2AMessage;
  log: { debug: (message: string) => void; warn: (message: string) => void };
}): Promise<SendResult> {
  const { peerInstanceUrl, message, log } = params;
  const url = `${peerInstanceUrl.replace(/\/+$/, "")}${A2A_MESSAGE_PATH}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(30_000),
    });

    if (resp.ok) {
      log.debug(`a2a message sent (taskId=${message.taskId}, messageId=${message.messageId})`);
      return { ok: true };
    }

    const err = `peer returned HTTP ${resp.status}`;
    log.warn(`a2a send failed: ${err} (taskId=${message.taskId})`);
    return { ok: false, error: err };
  } catch (err) {
    const error = `send failed: ${String(err)}`;
    log.warn(`a2a send error: ${error} (taskId=${message.taskId})`);
    return { ok: false, error };
  }
}
