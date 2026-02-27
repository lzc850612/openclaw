import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { A2A_TOOL_HINTS, getA2AStandingRules } from "./agent-tools-a2a.js";

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tools-a2a-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getA2AStandingRules
// ---------------------------------------------------------------------------

describe("getA2AStandingRules", () => {
  test("returns null when a2a-rules.md does not exist", () => {
    const result = getA2AStandingRules(tmpDir);
    expect(result).toBeNull();
  });

  test("returns file content when a2a-rules.md exists", () => {
    const rulesContent = "Always be polite.\nNever disclose secrets.";
    fs.writeFileSync(path.join(tmpDir, "a2a-rules.md"), rulesContent, "utf8");
    const result = getA2AStandingRules(tmpDir);
    expect(result).toBe(rulesContent);
  });

  test("returns null when a2a-rules.md is empty", () => {
    fs.writeFileSync(path.join(tmpDir, "a2a-rules.md"), "", "utf8");
    const result = getA2AStandingRules(tmpDir);
    expect(result).toBeNull();
  });

  test("returns null when a2a-rules.md contains only whitespace", () => {
    fs.writeFileSync(path.join(tmpDir, "a2a-rules.md"), "   \n   \n  ", "utf8");
    const result = getA2AStandingRules(tmpDir);
    expect(result).toBeNull();
  });

  test("trims surrounding whitespace from file content", () => {
    fs.writeFileSync(path.join(tmpDir, "a2a-rules.md"), "\n  rule one  \n\n", "utf8");
    const result = getA2AStandingRules(tmpDir);
    expect(result).toBe("rule one");
  });
});

// ---------------------------------------------------------------------------
// A2A_TOOL_HINTS
// ---------------------------------------------------------------------------

describe("A2A_TOOL_HINTS", () => {
  test("contains a2a_create_human_gate", () => {
    expect(A2A_TOOL_HINTS).toContain("a2a_create_human_gate");
  });

  test("contains a2a_send_completing", () => {
    expect(A2A_TOOL_HINTS).toContain("a2a_send_completing");
  });

  test("is a non-empty string", () => {
    expect(typeof A2A_TOOL_HINTS).toBe("string");
    expect(A2A_TOOL_HINTS.length).toBeGreaterThan(0);
  });
});
