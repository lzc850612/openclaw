import fs from "node:fs";
import path from "node:path";

/**
 * Stub A2A agent tools for Phase 8.
 * Full implementation integrated into the openclaw-peer channel plugin in Phase 9.
 */
export const A2A_TOOL_HINTS = [
  "a2a_create_human_gate(question) — pause negotiation and ask your principal a question",
  "a2a_send_completing(result) — send your final answer and close the task",
].join("\n");

export function getA2AStandingRules(agentDir: string): string | null {
  const rulesPath = path.join(agentDir, "a2a-rules.md");
  if (!fs.existsSync(rulesPath)) {
    return null;
  }
  return fs.readFileSync(rulesPath, "utf8").trim() || null;
}
