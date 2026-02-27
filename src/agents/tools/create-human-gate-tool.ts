import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { parseA2AAgentId, parseA2ATaskId } from "../../a2a/session-keys.js";
import { countOpenGates, createGate, loadTask, transitionTask } from "../../a2a/task-store.js";
import { loadConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { resolveDefaultAgentId } from "../agent-scope.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const log = createSubsystemLogger("agents/a2a");

const A2ACreateHumanGateSchema = Type.Object({
  question: Type.String({
    description: "The question to pose to the human operator.",
  }),
  taskId: Type.Optional(
    Type.String({
      description: "The A2A task ID to gate. If omitted, derived from the current session key.",
    }),
  ),
});

type A2ACreateHumanGateToolOptions = {
  agentSessionKey?: string;
};

/**
 * Agent tool: a2a_create_human_gate
 *
 * Pauses an A2A task pending a human answer. Transitions the local task to
 * "waiting-human" and records a HumanGate in the task record. The remote peer
 * waits silently; no message is sent to it. Resume is triggered externally via
 * resumeA2ATaskAfterGate once a human provides an answer.
 */
export function createA2ACreateHumanGateTool(opts?: A2ACreateHumanGateToolOptions): AnyAgentTool {
  return {
    label: "A2A",
    name: "a2a_create_human_gate",
    description: `Pause an A2A task and wait for a human operator to answer a question.

Transitions the local task to "waiting-human" and records the question as a
HumanGate. The remote peer waits silently until the task is resumed externally.

Parameters:
- question: The question to pose to the human operator.
- taskId: The A2A task ID (optional — derived from session key when in an A2A session).`,
    parameters: A2ACreateHumanGateSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const question = readStringParam(params, "question", { required: true });

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

      const task = loadTask(agentId, taskId);
      if (!task) {
        throw new Error(`A2A task not found: ${taskId}`);
      }

      // Enforce the per-task gate limit.
      const maxGates = cfg.federation?.maxGatesPerTask ?? 5;
      const openCount = countOpenGates(agentId, taskId);
      if (openCount >= maxGates) {
        throw new Error(
          `too many human escalations — task ${taskId} already has ${openCount} pending gate(s) (limit: ${maxGates})`,
        );
      }

      // Transition to waiting-human (idempotent if already there).
      transitionTask(agentId, taskId, "waiting-human");

      const gateId = randomUUID();
      createGate(agentId, taskId, {
        id: gateId,
        taskId,
        agentId,
        question,
        status: "pending",
        createdAt: Date.now(),
      });

      log.debug("a2a human gate created", { taskId, gateId, question });

      return jsonResult({
        gateId,
        taskId,
        status: "waiting-human",
      });
    },
  };
}
