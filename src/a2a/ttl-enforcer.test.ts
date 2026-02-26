import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { createTask, loadTask } from "./task-store.js";
import { enforceA2ATTLs } from "./ttl-enforcer.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

const silentLog = {
  debug: () => {},
  warn: () => {},
};

function cfg(taskTtlMs?: number): OpenClawConfig {
  return {
    federation: { enabled: true, publicUrl: "http://localhost:18789", taskTtlMs },
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-ttl-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("enforceA2ATTLs", () => {
  test("does not fail tasks with no expiresAt", () => {
    // Create completing task without expiresAt — should never be failed by TTL.
    createTask(
      {
        taskId: "t-no-expiry",
        agentId: "main",
        role: "initiator",
        remoteInstanceUrl: "http://peer.example.com",
        remoteAgentId: "b",
        goal: "g",
        status: "completing",
      },
      tmpDir,
    );
    const failed = enforceA2ATTLs("main", cfg(), silentLog, tmpDir);
    expect(failed).toHaveLength(0);
    expect(loadTask("main", "t-no-expiry", tmpDir)?.status).toBe("completing");
  });

  test("does not fail completing task whose expiresAt is in the future", () => {
    const task = createTask(
      {
        taskId: "t-future",
        agentId: "main",
        role: "initiator",
        remoteInstanceUrl: "http://peer.example.com",
        remoteAgentId: "b",
        goal: "g",
        status: "completing",
      },
      tmpDir,
    );
    // Patch expiresAt to future timestamp via patchTask pattern — write directly for test simplicity.
    const taskPath = path.join(tmpDir, "agents", "main", "a2a", "t-future.json");
    fs.writeFileSync(taskPath, JSON.stringify({ ...task, expiresAt: Date.now() + 3_600_000 }));

    const failed = enforceA2ATTLs("main", cfg(), silentLog, tmpDir);
    expect(failed).toHaveLength(0);
    expect(loadTask("main", "t-future", tmpDir)?.status).toBe("completing");
  });

  test("force-fails completing task whose expiresAt has passed", () => {
    const task = createTask(
      {
        taskId: "t-expired",
        agentId: "main",
        role: "initiator",
        remoteInstanceUrl: "http://peer.example.com",
        remoteAgentId: "b",
        goal: "g",
        status: "completing",
      },
      tmpDir,
    );
    const taskPath = path.join(tmpDir, "agents", "main", "a2a", "t-expired.json");
    fs.writeFileSync(taskPath, JSON.stringify({ ...task, expiresAt: Date.now() - 1 }));

    const failed = enforceA2ATTLs("main", cfg(), silentLog, tmpDir);
    expect(failed).toEqual(["t-expired"]);
    expect(loadTask("main", "t-expired", tmpDir)?.status).toBe("failed");
  });

  test("does not touch active, closed, or failed tasks even if expiresAt has passed", () => {
    for (const [id, status] of [
      ["t-active", "active"],
      ["t-closed", "closed"],
      ["t-failed", "failed"],
    ] as const) {
      const t = createTask(
        {
          taskId: id,
          agentId: "main",
          role: "initiator",
          remoteInstanceUrl: "http://peer.example.com",
          remoteAgentId: "b",
          goal: "g",
          status,
        },
        tmpDir,
      );
      const p = path.join(tmpDir, "agents", "main", "a2a", `${id}.json`);
      fs.writeFileSync(p, JSON.stringify({ ...t, expiresAt: Date.now() - 1 }));
    }

    const failed = enforceA2ATTLs("main", cfg(), silentLog, tmpDir);
    expect(failed).toHaveLength(0);
    expect(loadTask("main", "t-active", tmpDir)?.status).toBe("active");
    expect(loadTask("main", "t-closed", tmpDir)?.status).toBe("closed");
    expect(loadTask("main", "t-failed", tmpDir)?.status).toBe("failed");
  });

  test("returns all expired completing task IDs when multiple are expired", () => {
    for (const id of ["t-exp-1", "t-exp-2", "t-exp-3"]) {
      const t = createTask(
        {
          taskId: id,
          agentId: "main",
          role: "initiator",
          remoteInstanceUrl: "http://peer.example.com",
          remoteAgentId: "b",
          goal: "g",
          status: "completing",
        },
        tmpDir,
      );
      const p = path.join(tmpDir, "agents", "main", "a2a", `${id}.json`);
      fs.writeFileSync(p, JSON.stringify({ ...t, expiresAt: Date.now() - 1 }));
    }

    const failed = enforceA2ATTLs("main", cfg(), silentLog, tmpDir);
    expect(failed.toSorted()).toEqual(["t-exp-1", "t-exp-2", "t-exp-3"]);
  });

  test("logs a warning for each force-failed task", () => {
    const warnings: string[] = [];
    const log = {
      debug: () => {},
      warn: (msg: string) => {
        warnings.push(msg);
      },
    };

    const task = createTask(
      {
        taskId: "t-warn",
        agentId: "main",
        role: "initiator",
        remoteInstanceUrl: "http://peer.example.com",
        remoteAgentId: "b",
        goal: "g",
        status: "completing",
      },
      tmpDir,
    );
    const taskPath = path.join(tmpDir, "agents", "main", "a2a", "t-warn.json");
    fs.writeFileSync(taskPath, JSON.stringify({ ...task, expiresAt: Date.now() - 1 }));

    enforceA2ATTLs("main", cfg(), log, tmpDir);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("force-failed");
  });
});
