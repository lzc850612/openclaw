import type { OpenClawConfig } from "../config/types.openclaw.js";
import { listExpiredCompletingTasks, transitionTask } from "./task-store.js";

const DEFAULT_TASK_TTL_MS = 86_400_000; // 24 hours
const DEFAULT_CHECK_INTERVAL_MS = 60_000; // check every minute

type TtlLog = {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
};

/**
 * Scan all completing tasks for a given agent and force-fail any that have
 * exceeded their TTL. Safe to call repeatedly; each call is a one-shot scan.
 *
 * Returns the list of task IDs that were transitioned to "failed".
 */
export function enforceA2ATTLs(
  agentId: string,
  cfg: OpenClawConfig,
  log: TtlLog,
  stateDir?: string,
): string[] {
  const taskTtlMs = cfg.federation?.taskTtlMs ?? DEFAULT_TASK_TTL_MS;
  const expired = listExpiredCompletingTasks(agentId, stateDir);
  const failed: string[] = [];

  for (const task of expired) {
    try {
      transitionTask(agentId, task.taskId, "failed", stateDir);
      log.warn("a2a: force-failed task past TTL", {
        taskId: task.taskId,
        expiresAt: task.expiresAt,
        taskTtlMs,
      });
      // TODO(Phase 7): fire timeout notification to principal here.
      failed.push(task.taskId);
    } catch (err) {
      log.debug("a2a: could not force-fail expired task", {
        taskId: task.taskId,
        error: String(err),
      });
    }
  }

  return failed;
}

/**
 * Start a background interval that periodically calls enforceA2ATTLs for the
 * given agent. Returns a cleanup function to stop the interval.
 */
export function startA2ATTLEnforcer(
  agentId: string,
  cfg: OpenClawConfig,
  log: TtlLog,
  checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    enforceA2ATTLs(agentId, cfg, log);
  }, checkIntervalMs);

  // Allow the Node.js process to exit even if the timer is still running.
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return () => clearInterval(timer);
}
