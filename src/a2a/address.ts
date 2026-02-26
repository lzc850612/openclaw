/**
 * The canonical address of an agent in the A2A federation network.
 * An agent is uniquely identified by its local id combined with the base URL
 * of the gateway instance that hosts it.
 */
export type AgentAddress = {
  agentId: string;
  /** Base URL of the hosting gateway (e.g. "http://localhost:18789"). */
  instanceUrl: string;
};

/** Returns a human-readable address string: "agentId@instanceUrl". */
export function formatAgentAddress(addr: AgentAddress): string {
  return `${addr.agentId}@${addr.instanceUrl}`;
}
