import { type HumanGate, loadGates } from "./task-store.js";

/**
 * Returns the first pending HumanGate for the given agent+task, or null if
 * no pending gate exists. Used by inbound routing to detect tasks that are
 * paused waiting for a human answer before resuming agent execution.
 */
export function findOpenGate(agentId: string, taskId: string, stateDir?: string): HumanGate | null {
  const gates = loadGates(agentId, taskId, stateDir);
  return gates.find((g) => g.status === "pending") ?? null;
}
