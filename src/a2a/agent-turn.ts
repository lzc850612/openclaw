import { resolveAgentDir, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { resolveSessionAuthProfileOverride } from "../agents/auth-profiles/session-override.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import { runWithModelFallback } from "../agents/model-fallback.js";
import { resolveConfiguredModelRef, resolveThinkingDefault } from "../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
import { resolveAgentTimeoutMs } from "../agents/timeout.js";
import { ensureAgentWorkspace } from "../agents/workspace.js";
import { resolveSessionTranscriptPath, updateSessionStore } from "../config/sessions.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveCronSession } from "../cron/isolated-agent/session.js";
import { registerAgentRunContext } from "../infra/agent-events.js";
import { buildAgentMainSessionKey } from "../routing/session-key.js";
import type { A2ATask } from "./task-store.js";

export type RunA2AAgentTurnResult = {
  status: "ok" | "error";
  error?: string;
  outputText?: string;
};

/**
 * Run an isolated agent reasoning turn in response to an inbound A2A message.
 *
 * Replaces the fake CronJob pattern previously used in gateway-handler.ts.
 * Calls runEmbeddedPiAgent directly with a proper A2A-contextual prompt so the
 * agent knows it is in an A2A session and should call a2a_send_completing when done.
 */
export async function runA2AAgentTurn(params: {
  cfg: OpenClawConfig;
  agentId: string;
  task: A2ATask;
  message: string;
  /** "agent:<agentId>:a2a:<taskId>" — wires a2a_send_completing with the right taskId. */
  sessionKey: string;
  abortSignal?: AbortSignal;
}): Promise<RunA2AAgentTurnResult> {
  const { cfg, agentId, task, message, sessionKey, abortSignal } = params;
  const now = Date.now();

  // Build the session key in the same canonical form used by the rest of the codebase.
  const agentSessionKey = buildAgentMainSessionKey({ agentId, mainKey: sessionKey });

  // Fresh isolated session — no context carryover from previous turns.
  const cronSession = resolveCronSession({
    cfg,
    sessionKey: agentSessionKey,
    agentId,
    nowMs: now,
    forceNew: true,
  });
  const sessionId = cronSession.sessionEntry.sessionId;

  // Model resolution.
  const resolved = resolveConfiguredModelRef({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  let provider = resolved.provider;
  let model = resolved.model;

  const catalog = await loadModelCatalog({ config: cfg });

  const thinkLevel = resolveThinkingDefault({ cfg, provider, model, catalog });
  const timeoutMs = resolveAgentTimeoutMs({ cfg });

  const agentDir = resolveAgentDir(cfg, agentId);
  const workspaceDirRaw = resolveAgentWorkspaceDir(cfg, agentId);
  const workspace = await ensureAgentWorkspace({ dir: workspaceDirRaw });
  const workspaceDir = workspace.dir;

  // Mirror the auth profile resolution from the cron runner.
  const authProfileId = await resolveSessionAuthProfileOverride({
    cfg,
    provider,
    agentDir,
    sessionEntry: cronSession.sessionEntry,
    sessionStore: cronSession.store,
    sessionKey: agentSessionKey,
    storePath: cronSession.storePath,
    isNewSession: cronSession.isNewSession,
  });
  const authProfileIdSource = cronSession.sessionEntry.authProfileOverrideSource;

  cronSession.sessionEntry.systemSent = true;
  await updateSessionStore(cronSession.storePath, (store) => {
    store[agentSessionKey] = cronSession.sessionEntry;
  });

  registerAgentRunContext(sessionId, { sessionKey: agentSessionKey, verboseLevel: "off" });

  // Build an A2A-contextual prompt so the agent understands its role.
  const prompt = [
    `You are handling an A2A collaboration request from a remote agent.`,
    ``,
    `Remote agent: ${task.remoteAgentId} @ ${task.remoteInstanceUrl}`,
    `Task goal: ${task.goal}`,
    `Task ID: ${task.taskId}`,
    ``,
    `Message from remote agent:`,
    message.trim(),
    ``,
    `When you have finished your work, call a2a_send_completing(result) with your final answer.`,
  ].join("\n");

  try {
    const fallbackResult = await runWithModelFallback({
      cfg,
      provider,
      model,
      agentDir,
      run: (providerOverride, modelOverride) => {
        if (abortSignal?.aborted) {
          throw new Error("a2a: agent turn aborted");
        }
        return runEmbeddedPiAgent({
          sessionId,
          sessionKey: agentSessionKey,
          agentId,
          sessionFile: resolveSessionTranscriptPath(sessionId, agentId),
          workspaceDir,
          agentDir,
          config: cfg,
          prompt,
          provider: providerOverride,
          model: modelOverride,
          authProfileId,
          authProfileIdSource,
          thinkLevel,
          timeoutMs,
          runId: sessionId,
          lane: "a2a",
          requireExplicitMessageTarget: true,
          abortSignal,
        });
      },
    });

    const outputText =
      fallbackResult.result.payloads
        ?.map((p) => p.text?.trim())
        .filter(Boolean)
        .join("\n") || undefined;

    provider = fallbackResult.provider;
    model = fallbackResult.model;

    return { status: "ok", outputText };
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}
