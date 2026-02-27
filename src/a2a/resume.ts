import type { OpenClawConfig } from "../config/types.openclaw.js";
import { runA2AAgentTurn } from "./agent-turn.js";
import { buildA2ASessionKey } from "./session-keys.js";
import { answerGate, loadTask, transitionTask } from "./task-store.js";

/**
 * Resume an A2A task after a HumanGate has been answered.
 *
 * 1. Marks the gate as answered.
 * 2. Transitions the task from "waiting-human" back to "active".
 * 3. Injects the human's answer as a context message and runs a fresh agent turn.
 */
export async function resumeA2ATaskAfterGate(params: {
  cfg: OpenClawConfig;
  agentId: string;
  taskId: string;
  gateId: string;
  answer: string;
}): Promise<void> {
  const { cfg, agentId, taskId, gateId, answer } = params;

  // Persist the answer on the gate record.
  answerGate(agentId, taskId, gateId, answer);

  // Resume the task state machine.
  transitionTask(agentId, taskId, "active");

  const task = loadTask(agentId, taskId);
  if (!task) {
    throw new Error(`A2A task not found after resume: ${taskId}`);
  }

  // Build a fresh A2A session key so the resumed agent turn has the right context.
  const sessionKey = buildA2ASessionKey(agentId, taskId);

  // Inject the human's answer as a context message for the agent.
  const contextMessage = `Human answered gate ${gateId}: ${answer}`;

  await runA2AAgentTurn({
    cfg,
    agentId,
    task,
    message: contextMessage,
    sessionKey,
  });
}
