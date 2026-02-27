/**
 * Returns the set of tool names that are BLOCKED in A2A sessions.
 * A2A sessions run with reduced permissions: no shell, no arbitrary FS access.
 * Principals can override this via agent config (Phase 9+).
 */
export function getA2ABlockedTools(): string[] {
  return [
    "bash",
    "execute_command",
    "run_shell",
    "shell",
    "write_file",
    "delete_file",
    "create_file",
  ];
}

export function isToolBlockedInA2A(toolName: string): boolean {
  return getA2ABlockedTools().includes(toolName.toLowerCase());
}
