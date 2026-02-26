import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { discoverPeer } from "../../a2a/discovery.js";
import { enqueueAndSend } from "../../a2a/message-queue.js";
import { buildA2ASessionKey } from "../../a2a/session-keys.js";
import { createTask } from "../../a2a/task-store.js";
import { loadConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { resolveDefaultAgentId, resolveSessionAgentId } from "../agent-scope.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const log = createSubsystemLogger("agents/a2a");

const A2AStartTaskSchema = Type.Object({
  remoteInstanceUrl: Type.String({
    description: "The public URL of the remote OpenClaw gateway (e.g. https://peer.example.com).",
  }),
  remoteAgentId: Type.String({
    description: "The agent ID to contact on the remote gateway.",
  }),
  goal: Type.String({
    description: "A brief human-readable description of the task goal.",
  }),
  message: Type.String({
    description: "The first message to send to the remote agent.",
  }),
});

type A2AToolOptions = {
  agentSessionKey?: string;
};

/**
 * Agent tool: a2a_start_task
 *
 * Discovers a peer OpenClaw gateway, creates a local A2A task record, and
 * sends the first message to the remote agent.  Returns the taskId so the
 * agent can track progress in follow-up turns.
 */
export function createA2ATool(opts?: A2AToolOptions): AnyAgentTool {
  return {
    label: "A2A",
    name: "a2a_start_task",
    description: `Start a task on a remote OpenClaw agent via A2A federation.

Discovers the peer gateway, creates a local task record, and sends the first
message.  Returns the taskId for tracking.

Parameters:
- remoteInstanceUrl: Public URL of the remote OpenClaw gateway.
- remoteAgentId: Agent ID to contact on the remote gateway.
- goal: Short description of what you want the remote agent to accomplish.
- message: First message to send.`,
    parameters: A2AStartTaskSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const remoteInstanceUrl = readStringParam(params, "remoteInstanceUrl", { required: true });
      const remoteAgentId = readStringParam(params, "remoteAgentId", { required: true });
      const goal = readStringParam(params, "goal", { required: true });
      const message = readStringParam(params, "message", { required: true });

      const cfg = loadConfig();
      // Prefer the session's own agent ID when available, fall back to default.
      const localAgentId = opts?.agentSessionKey
        ? (resolveSessionAgentId({ sessionKey: opts.agentSessionKey, config: cfg }) ??
          resolveDefaultAgentId(cfg))
        : resolveDefaultAgentId(cfg);
      const localInstanceUrl = cfg.federation?.publicUrl ?? "";

      if (!localInstanceUrl) {
        throw new Error("federation.publicUrl must be configured before starting A2A tasks");
      }

      // Discover peer to verify A2A capability.
      const discovery = await discoverPeer(remoteInstanceUrl, remoteAgentId);
      if (!discovery.ok) {
        throw new Error(`A2A peer discovery failed: ${discovery.error}`);
      }

      const taskId = randomUUID();
      const messageId = randomUUID();

      // Persist task record locally.
      createTask({
        taskId,
        agentId: localAgentId,
        role: "initiator",
        remoteInstanceUrl: discovery.instanceUrl,
        remoteAgentId,
        goal,
        status: "active",
      });

      log.debug("a2a task created", {
        taskId,
        localAgent: `${localAgentId}@${localInstanceUrl}`,
        remoteAgent: `${remoteAgentId}@${discovery.instanceUrl}`,
      });

      // Enqueue and send the first message.
      const outbound = {
        taskId,
        messageId,
        fromInstanceUrl: localInstanceUrl,
        fromAgentId: localAgentId,
        type: "task.request",
        content: message,
      };

      const sendResult = await enqueueAndSend({
        agentId: localAgentId,
        peerInstanceUrl: discovery.instanceUrl,
        message: outbound,
        log,
      });

      if (!sendResult.ok) {
        // Task created; message pending in outbox — return taskId anyway.
        log.debug("a2a first message enqueued but not yet delivered", {
          taskId,
          error: sendResult.error,
        });
      }

      const sessionKey = buildA2ASessionKey(localAgentId, taskId);
      return jsonResult({
        taskId,
        sessionKey,
        remoteInstanceUrl: discovery.instanceUrl,
        remoteAgentId,
        messageSent: sendResult.ok,
      });
    },
  };
}
