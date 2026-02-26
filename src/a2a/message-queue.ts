import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { retryAsync } from "../infra/retry.js";
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

export type OutboxEntry = {
  message: OutboundA2AMessage;
  peerInstanceUrl: string;
  agentId: string;
  status: "pending" | "sent" | "failed";
  enqueuedAtMs: number;
  sentAtMs?: number;
};

// ---------------------------------------------------------------------------
// Outbox persistence
// ---------------------------------------------------------------------------

function resolveOutboxDir(stateDir: string, agentId: string): string {
  return path.join(stateDir, "agents", agentId, "a2a", "outbox");
}

function resolveEntryPath(stateDir: string, agentId: string, messageId: string): string {
  return path.join(resolveOutboxDir(stateDir, agentId), `${messageId}.json`);
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function saveOutboxEntry(entry: OutboxEntry, stateDir: string): void {
  writeJsonAtomic(resolveEntryPath(stateDir, entry.agentId, entry.message.messageId), entry);
}

function loadOutboxEntry(stateDir: string, agentId: string, messageId: string): OutboxEntry | null {
  const filePath = resolveEntryPath(stateDir, agentId, messageId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as OutboxEntry;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core send (single HTTP attempt — used by retry wrapper below)
// ---------------------------------------------------------------------------

async function attemptSend(peerInstanceUrl: string, message: OutboundA2AMessage): Promise<void> {
  const url = `${peerInstanceUrl.replace(/\/+$/, "")}${A2A_MESSAGE_PATH}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

type SendLog = {
  debug: (message: string) => void;
  warn: (message: string) => void;
};

/**
 * Enqueue an outbound A2A message, persist it to the outbox, then deliver
 * with exponential backoff (up to 5 attempts). Idempotent: if the messageId
 * is already marked "sent", the call returns immediately without re-sending.
 */
export async function enqueueAndSend(params: {
  agentId: string;
  peerInstanceUrl: string;
  message: OutboundA2AMessage;
  log: SendLog;
  stateDir?: string;
}): Promise<SendResult> {
  const { agentId, peerInstanceUrl, message, log } = params;
  const stateDir = params.stateDir ?? resolveStateDir();

  // Idempotency: skip if already sent.
  const existing = loadOutboxEntry(stateDir, agentId, message.messageId);
  if (existing?.status === "sent") {
    log.debug(`a2a outbox: already sent messageId=${message.messageId}, skipping`);
    return { ok: true };
  }

  // Persist as pending before attempting delivery.
  const entry: OutboxEntry = {
    message,
    peerInstanceUrl,
    agentId,
    status: "pending",
    enqueuedAtMs: Date.now(),
  };
  saveOutboxEntry(entry, stateDir);

  try {
    await retryAsync(() => attemptSend(peerInstanceUrl, message), {
      attempts: 5,
      minDelayMs: 1_000,
      maxDelayMs: 30_000,
      jitter: 0.2,
      label: `a2a send ${message.messageId}`,
      onRetry: (info) => {
        log.warn(
          `a2a send retry ${info.attempt}/${info.maxAttempts} ` +
            `messageId=${message.messageId} err=${String(info.err)}`,
        );
      },
    });

    saveOutboxEntry({ ...entry, status: "sent", sentAtMs: Date.now() }, stateDir);
    log.debug(`a2a message sent taskId=${message.taskId} messageId=${message.messageId}`);
    return { ok: true };
  } catch (err) {
    const error = `send failed after retries: ${String(err)}`;
    saveOutboxEntry({ ...entry, status: "failed" }, stateDir);
    log.warn(`a2a send failed: ${error} taskId=${message.taskId}`);
    return { ok: false, error };
  }
}

/**
 * Load all pending outbox entries for an agent.
 * Used at startup to re-enqueue messages that were interrupted.
 */
export function loadPendingOutboxEntries(agentId: string, stateDir?: string): OutboxEntry[] {
  const dir = stateDir ?? resolveStateDir();
  const outboxDir = resolveOutboxDir(dir, agentId);
  if (!fs.existsSync(outboxDir)) {
    return [];
  }
  const entries: OutboxEntry[] = [];
  for (const file of fs.readdirSync(outboxDir)) {
    if (!file.endsWith(".json") || file.startsWith(".")) {
      continue;
    }
    const messageId = file.slice(0, -".json".length);
    const entry = loadOutboxEntry(dir, agentId, messageId);
    if (entry?.status === "pending") {
      entries.push(entry);
    }
  }
  return entries;
}

/**
 * Low-level fire-and-forget send (no persistence, no retry).
 * Preserved for backward compatibility with Phase 2 tests and simple callers.
 */
export async function sendA2aMessage(params: {
  peerInstanceUrl: string;
  message: OutboundA2AMessage;
  log: SendLog;
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
