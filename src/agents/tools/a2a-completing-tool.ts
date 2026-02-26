import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { enqueueAndSend } from "../../a2a/message-queue.js";
import { parseA2AAgentId, parseA2ATaskId } from "../../a2a/session-keys.js";
import { loadTask, transitionTask } from "../../a2a/task-store.js";
import { loadConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { resolveDefaultAgentId } from "../agent-scope.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const log = createSubsystemLogger("agents/a2a");

const A2ACompletingSchema = Type.Object({
  result: Type.String({
    description: "The final result or conclusion to send to the remote agent.",
  }),
  taskId: Type.Optional(
    Type.String({
      description: "The A2A task ID to complete. If omitted, derived from the current session key.",
    }),
  ),
});

type A2ACompletingToolOptions = {
  agentSessionKey?: string;
};

/**
 * Agent tool: a2a_send_completing
 *
 * Signals to the remote agent that this side is done with the negotiation.
 * Sends a { type: "completing", content: result } message via the outbox and
 * transitions the local task to "completing" status.
 *
 * The gateway automatically sends "completed" and closes the task once the
 * remote agent acknowledges with its own "completed" message.
 */
export function createA2ACompletingTool(opts?: A2ACompletingToolOptions): AnyAgentTool {
  return {
    label: "A2A",
    name: "a2a_send_completing",
    description: `Signal that you are done with an A2A negotiation task.

Sends a "completing" message to the remote agent with the final result, and
sets the local task status to "completing". The handshake completes when the
remote side acknowledges with "completed".

Parameters:
- result: The final outcome or conclusion to send to the remote agent.
- taskId: The A2A task ID (optional — derived from session key when in an A2A session).`,
    parameters: A2ACompletingSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const result = readStringParam(params, "result", { required: true });

      const cfg = loadConfig();

      // Resolve agentId and taskId from session key when available.
      const sessionKey = opts?.agentSessionKey;
      const agentId =
        (sessionKey ? parseA2AAgentId(sessionKey) : null) ?? resolveDefaultAgentId(cfg);
      const taskIdFromSession = sessionKey ? parseA2ATaskId(sessionKey) : null;
      const taskId =
        readStringParam(params, "taskId", { required: false }) ?? taskIdFromSession ?? null;

      if (!taskId) {
        throw new Error(
          "taskId is required — either pass it explicitly or call this tool from an A2A session",
        );
      }

      const localInstanceUrl = cfg.federation?.publicUrl ?? "";
      if (!localInstanceUrl) {
        throw new Error("federation.publicUrl must be configured before sending A2A messages");
      }

      const task = loadTask(agentId, taskId);
      if (!task) {
        throw new Error(`A2A task not found: ${taskId}`);
      }
      if (task.status !== "active" && task.status !== "waiting-human") {
        throw new Error(
          `Cannot send completing from task in status "${task.status}" — task must be active`,
        );
      }

      const messageId = randomUUID();
      const outbound = {
        taskId,
        messageId,
        fromInstanceUrl: localInstanceUrl,
        fromAgentId: agentId,
        type: "completing" as const,
        content: result,
      };

      // Transition to completing before sending so state is durable even if send fails.
      transitionTask(agentId, taskId, "completing");

      log.debug("a2a send_completing", {
        taskId,
        messageId,
        remoteAgent: `${task.remoteAgentId}@${task.remoteInstanceUrl}`,
      });

      const sendResult = await enqueueAndSend({
        agentId,
        peerInstanceUrl: task.remoteInstanceUrl,
        message: outbound,
        log,
      });

      if (!sendResult.ok) {
        log.debug("a2a send_completing enqueued but delivery pending", {
          taskId,
          error: sendResult.error,
        });
      }

      return jsonResult({
        taskId,
        messageId,
        status: "completing",
        messageSent: sendResult.ok,
      });
    },
  };
}
