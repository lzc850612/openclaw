import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { buildMonitorHtml } from "./monitor-ui.js";
import { listAllTaskIds, loadTask, type A2ATask } from "./task-store.js";

export const MONITOR_TASKS_PATH = "/a2a/tasks";
export const MONITOR_UI_PATH = "/a2a/monitor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function methodNotAllowed(res: ServerResponse): void {
  res.statusCode = 405;
  res.setHeader("Allow", "GET");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Method Not Allowed");
}

/** List all agent directory names under stateDir/agents/. */
function listAgentIds(stateDir: string): string[] {
  const agentsDir = path.join(stateDir, "agents");
  if (!fs.existsSync(agentsDir)) {
    return [];
  }
  try {
    return fs
      .readdirSync(agentsDir)
      .filter((name) => fs.statSync(path.join(agentsDir, name)).isDirectory());
  } catch {
    return [];
  }
}

/** Derive message direction from fromInstanceUrl vs local publicUrl. */
function messageDirection(fromInstanceUrl: string, localInstanceUrl: string): "out" | "in" {
  const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();
  return norm(fromInstanceUrl) === norm(localInstanceUrl) ? "out" : "in";
}

function toTaskSummary(task: A2ATask) {
  return {
    taskId: task.taskId,
    agentId: task.agentId,
    role: task.role,
    status: task.status,
    remoteInstanceUrl: task.remoteInstanceUrl,
    remoteAgentId: task.remoteAgentId,
    goal: task.goal,
    messageCount: task.messages.length,
    lastActivityAt: task.updatedAtMs,
    createdAtMs: task.createdAtMs,
  };
}

function toTaskDetail(task: A2ATask, localInstanceUrl: string) {
  const messages = task.messages.map((msg) => ({
    ...msg,
    direction: messageDirection(msg.fromInstanceUrl, localInstanceUrl),
  }));
  return { ...task, messages };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

/**
 * HTTP handler for A2A monitor routes:
 *   GET /a2a/tasks              → JSON array of task summaries
 *   GET /a2a/tasks/:taskId      → JSON full task with message direction
 *   GET /a2a/monitor            → HTML dashboard
 *
 * Returns false when the path is not in the /a2a/tasks or /a2a/monitor namespace
 * so the caller can continue its handler chain.
 */
export function handleMonitorRequest(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: OpenClawConfig,
  stateDir?: string,
): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;

  // ── GET /a2a/monitor ─────────────────────────────────────────────────────
  if (pathname === MONITOR_UI_PATH) {
    if (!cfg.federation?.enabled) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
      return true;
    }
    if (req.method !== "GET") {
      methodNotAllowed(res);
      return true;
    }
    sendHtml(res, buildMonitorHtml());
    return true;
  }

  // ── GET /a2a/tasks ────────────────────────────────────────────────────────
  if (pathname === MONITOR_TASKS_PATH) {
    if (!cfg.federation?.enabled) {
      sendJson(res, 404, { ok: false, error: "federation not enabled" });
      return true;
    }
    if (req.method !== "GET") {
      methodNotAllowed(res);
      return true;
    }
    const dir = stateDir ?? resolveStateDir();
    const summaries = [];
    for (const agentId of listAgentIds(dir)) {
      for (const taskId of listAllTaskIds(agentId, dir)) {
        const task = loadTask(agentId, taskId, dir);
        if (task) {
          summaries.push(toTaskSummary(task));
        }
      }
    }
    // Most-recently-active tasks first.
    summaries.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    sendJson(res, 200, summaries);
    return true;
  }

  // ── GET /a2a/tasks/:taskId ────────────────────────────────────────────────
  const taskMatch = /^\/a2a\/tasks\/([^/]+)$/.exec(pathname);
  if (taskMatch) {
    if (!cfg.federation?.enabled) {
      sendJson(res, 404, { ok: false, error: "federation not enabled" });
      return true;
    }
    if (req.method !== "GET") {
      methodNotAllowed(res);
      return true;
    }
    const taskId = taskMatch[1] ?? "";
    const dir = stateDir ?? resolveStateDir();
    let found: A2ATask | null = null;
    for (const agentId of listAgentIds(dir)) {
      const task = loadTask(agentId, taskId, dir);
      if (task) {
        found = task;
        break;
      }
    }
    if (!found) {
      sendJson(res, 404, { ok: false, error: `task not found: ${taskId}` });
      return true;
    }
    const localUrl = cfg.federation?.publicUrl ?? "";
    sendJson(res, 200, toTaskDetail(found, localUrl));
    return true;
  }

  return false;
}
