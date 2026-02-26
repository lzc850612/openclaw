export type A2ATaskStatus = "active" | "completing" | "closed" | "waiting-human" | "failed";

// Allowed transitions per source state.
const VALID_TRANSITIONS: Readonly<Record<A2ATaskStatus, readonly A2ATaskStatus[]>> = {
  // active → closed: receiver of a "completing" message goes directly to closed
  // after its agent turn + auto-sending "completed", without going through completing.
  active: ["completing", "closed", "waiting-human", "failed"],
  completing: ["closed", "failed"],
  "waiting-human": ["active", "failed"],
  closed: [],
  failed: [],
};

/** Returns true when transitioning from → to is a legal state-machine step. */
export function canTransition(from: A2ATaskStatus, to: A2ATaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Terminal states that must not be re-opened. */
export function isTerminalStatus(status: A2ATaskStatus): boolean {
  return status === "closed" || status === "failed";
}
