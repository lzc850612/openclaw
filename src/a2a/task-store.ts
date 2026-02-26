import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { A2ATaskStatus } from "./task-state.js";
import { canTransition, isTerminalStatus } from "./task-state.js";

export type { A2ATaskStatus };

/** Well-known A2A protocol message types. */
export type A2AMessageType = "message" | "completing" | "completed" | "error";

export type A2AMessage = {
  messageId: string;
  fromInstanceUrl: string;
  fromAgentId: string;
  /** Protocol type. Stored as string to preserve any non-standard values on disk. */
  type: string;
  content: string;
  receivedAtMs: number;
};

export type A2ATask = {
  taskId: string;
  agentId: string;
  /** "initiator" if this instance started the task; "responder" otherwise. */
  role: "initiator" | "responder";
  remoteInstanceUrl: string;
  remoteAgentId: string;
  goal: string;
  status: A2ATaskStatus;
  createdAtMs: number;
  updatedAtMs: number;
  /** Unix-ms after which a stuck completing task is force-failed. Optional. */
  expiresAt?: number;
  messages: A2AMessage[];
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function resolveA2aDir(stateDir: string, agentId: string): string {
  return path.join(stateDir, "agents", agentId, "a2a");
}

function resolveTaskPath(stateDir: string, agentId: string, taskId: string): string {
  return path.join(resolveA2aDir(stateDir, agentId), `${taskId}.json`);
}

// ---------------------------------------------------------------------------
// Atomic write helper
// ---------------------------------------------------------------------------

function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Create a new task and persist it to disk. Throws if taskId already exists. */
export function createTask(
  params: Omit<A2ATask, "createdAtMs" | "updatedAtMs" | "messages">,
  stateDir?: string,
): A2ATask {
  const dir = stateDir ?? resolveStateDir();
  const task: A2ATask = {
    ...params,
    messages: [],
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
  const filePath = resolveTaskPath(dir, params.agentId, params.taskId);
  if (fs.existsSync(filePath)) {
    throw new Error(`A2A task already exists: ${params.taskId}`);
  }
  writeJsonAtomic(filePath, task);
  return task;
}

/** Load a task from disk. Returns null if not found. */
export function loadTask(agentId: string, taskId: string, stateDir?: string): A2ATask | null {
  const dir = stateDir ?? resolveStateDir();
  const filePath = resolveTaskPath(dir, agentId, taskId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as A2ATask;
  } catch {
    return null;
  }
}

/** Apply a partial patch to a task (non-status fields only). Persists atomically. */
export function patchTask(
  agentId: string,
  taskId: string,
  patch: Partial<Omit<A2ATask, "taskId" | "agentId" | "createdAtMs" | "messages">>,
  stateDir?: string,
): A2ATask {
  const dir = stateDir ?? resolveStateDir();
  const task = loadTask(agentId, taskId, dir);
  if (!task) {
    throw new Error(`A2A task not found: ${taskId}`);
  }
  const updated: A2ATask = { ...task, ...patch, updatedAtMs: Date.now() };
  writeJsonAtomic(resolveTaskPath(dir, agentId, taskId), updated);
  return updated;
}

/**
 * Transition a task to a new status following the state machine.
 * Throws if the transition is illegal or the task is not found.
 */
export function transitionTask(
  agentId: string,
  taskId: string,
  to: A2ATaskStatus,
  stateDir?: string,
): A2ATask {
  const dir = stateDir ?? resolveStateDir();
  const task = loadTask(agentId, taskId, dir);
  if (!task) {
    throw new Error(`A2A task not found: ${taskId}`);
  }
  if (task.status === to) {
    return task;
  }
  if (!canTransition(task.status, to)) {
    throw new Error(`A2A task ${taskId}: invalid transition ${task.status} → ${to}`);
  }
  return patchTask(agentId, taskId, { status: to }, dir);
}

/** Append an inbound message to a task. Skips if messageId already recorded. */
export function appendMessage(
  agentId: string,
  taskId: string,
  msg: A2AMessage,
  stateDir?: string,
): A2ATask {
  const dir = stateDir ?? resolveStateDir();
  const task = loadTask(agentId, taskId, dir);
  if (!task) {
    throw new Error(`A2A task not found: ${taskId}`);
  }
  if (isTerminalStatus(task.status)) {
    throw new Error(`A2A task ${taskId} is ${task.status}; cannot append message`);
  }
  // Idempotency — skip duplicate message IDs.
  if (task.messages.some((m) => m.messageId === msg.messageId)) {
    return task;
  }
  const updated: A2ATask = {
    ...task,
    messages: [...task.messages, msg],
    updatedAtMs: Date.now(),
  };
  writeJsonAtomic(resolveTaskPath(dir, agentId, taskId), updated);
  return updated;
}

/** List all task IDs for an agent. Returns empty array if none exist. */
export function listAllTaskIds(agentId: string, stateDir?: string): string[] {
  const dir = stateDir ?? resolveStateDir();
  const a2aDir = resolveA2aDir(dir, agentId);
  if (!fs.existsSync(a2aDir)) {
    return [];
  }
  return fs
    .readdirSync(a2aDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("."))
    .map((f) => f.slice(0, -".json".length));
}

/** List tasks for an agent that match any of the given statuses. */
export function listTasksByStatus(
  agentId: string,
  statuses: A2ATaskStatus[],
  stateDir?: string,
): A2ATask[] {
  const dir = stateDir ?? resolveStateDir();
  const ids = listAllTaskIds(agentId, dir);
  const result: A2ATask[] = [];
  for (const id of ids) {
    const task = loadTask(agentId, id, dir);
    if (task && statuses.includes(task.status)) {
      result.push(task);
    }
  }
  return result;
}

/**
 * List tasks in `completing` state whose `expiresAt` has passed.
 * Used by the TTL enforcer to find tasks that need to be force-failed.
 */
export function listExpiredCompletingTasks(agentId: string, stateDir?: string): A2ATask[] {
  const now = Date.now();
  return listTasksByStatus(agentId, ["completing"], stateDir).filter(
    (t) => t.expiresAt !== undefined && t.expiresAt <= now,
  );
}
