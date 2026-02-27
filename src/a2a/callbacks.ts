import type { OpenClawConfig } from "../config/types.openclaw.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { runA2AAgentTurn } from "./agent-turn.js";
import type { A2ATask } from "./task-store.js";

const log = createSubsystemLogger("a2a");

/**
 * Fire a completion callback to the initiator's original channel session.
 *
 * Called when an initiator-side task transitions to `closed` after receiving
 * the peer's `completed` message. Re-uses the original callback session key
 * so the agent's summary reply reaches the user's channel.
 *
 * No-op if the task is not an initiator task or has no callbackSessionKey.
 */
export async function dispatchCompletionCallback(params: {
  cfg: OpenClawConfig;
  agentId: string;
  task: A2ATask;
}): Promise<void> {
  const { cfg, agentId, task } = params;

  if (task.role !== "initiator" || !task.callbackSessionKey) {
    return;
  }

  const summary = [
    "The A2A task you initiated has completed.",
    `Task ID: ${task.taskId}`,
    `Remote agent: ${task.remoteAgentId} @ ${task.remoteInstanceUrl}`,
    `Goal: ${task.goal}`,
    "",
    "The remote agent has finished. Please summarise the outcome for the user based on the task transcript.",
  ].join("\n");

  log.debug("a2a: dispatching completion callback", {
    taskId: task.taskId,
    callbackSessionKey: task.callbackSessionKey,
  });

  const result = await runA2AAgentTurn({
    cfg,
    agentId,
    task,
    message: summary,
    sessionKey: task.callbackSessionKey,
  });

  if (result.status === "error") {
    log.warn("a2a: completion callback agent turn failed", {
      taskId: task.taskId,
      error: result.error,
    });
  }
}

/**
 * Notify the participant (responder) side that their task has closed.
 *
 * Phase 9 will deliver this to the participant's primary channel.
 * For now, just log a debug message as a stub.
 */
export async function dispatchParticipantNotification(params: {
  cfg: OpenClawConfig;
  agentId: string;
  task: A2ATask;
}): Promise<void> {
  const { task } = params;

  if (task.role !== "responder") {
    return;
  }

  // TODO(Phase 9): deliver notification to participant's primary channel.
  log.debug("a2a: task closed on participant side, no callback session to notify", {
    taskId: task.taskId,
  });
}
