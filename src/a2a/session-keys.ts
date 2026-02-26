import { parseAgentSessionKey } from "../sessions/session-key-utils.js";

const A2A_PREFIX = "a2a:";

/**
 * Build an A2A session key for a given agent and task.
 * Format: agent:<agentId>:a2a:<taskId>
 */
export function buildA2ASessionKey(agentId: string, taskId: string): string {
  return `agent:${agentId}:a2a:${taskId}`;
}

/** Returns true if the session key belongs to an A2A task session. */
export function isA2ASessionKey(sessionKey: string): boolean {
  const parsed = parseAgentSessionKey(sessionKey);
  return parsed != null && parsed.rest.startsWith(A2A_PREFIX);
}

/**
 * Extracts the taskId from an A2A session key.
 * Returns null if the key is not an A2A session key or the taskId is empty.
 */
export function parseA2ATaskId(sessionKey: string): string | null {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed || !parsed.rest.startsWith(A2A_PREFIX)) {
    return null;
  }
  const taskId = parsed.rest.slice(A2A_PREFIX.length).trim();
  return taskId || null;
}

/**
 * Extracts the agentId from an A2A session key.
 * Returns null if the key is not an A2A session key.
 */
export function parseA2AAgentId(sessionKey: string): string | null {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed || !parsed.rest.startsWith(A2A_PREFIX)) {
    return null;
  }
  return parsed.agentId;
}
