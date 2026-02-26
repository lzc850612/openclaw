import { describe, expect, test } from "vitest";
import { canTransition, isTerminalStatus, type A2ATaskStatus } from "./task-state.js";

describe("canTransition", () => {
  // active transitions
  test("active → completing is allowed", () => {
    expect(canTransition("active", "completing")).toBe(true);
  });
  test("active → waiting-human is allowed", () => {
    expect(canTransition("active", "waiting-human")).toBe(true);
  });
  test("active → failed is allowed", () => {
    expect(canTransition("active", "failed")).toBe(true);
  });
  // active → closed: receiver of "completing" goes directly to closed
  // (dispatches agent turn, sends "completed", then closes without going through completing)
  test("active → closed is allowed (receiver of completing skips completing state)", () => {
    expect(canTransition("active", "closed")).toBe(true);
  });

  // completing transitions
  test("completing → closed is allowed", () => {
    expect(canTransition("completing", "closed")).toBe(true);
  });
  test("completing → failed is allowed", () => {
    expect(canTransition("completing", "failed")).toBe(true);
  });
  test("completing → active is NOT allowed", () => {
    expect(canTransition("completing", "active")).toBe(false);
  });

  // waiting-human transitions
  test("waiting-human → active is allowed", () => {
    expect(canTransition("waiting-human", "active")).toBe(true);
  });
  test("waiting-human → failed is allowed", () => {
    expect(canTransition("waiting-human", "failed")).toBe(true);
  });
  test("waiting-human → completing is NOT allowed", () => {
    expect(canTransition("waiting-human", "completing")).toBe(false);
  });

  // terminal states
  test("closed → active is NOT allowed", () => {
    expect(canTransition("closed", "active")).toBe(false);
  });
  test("failed → active is NOT allowed", () => {
    expect(canTransition("failed", "active")).toBe(false);
  });
  test("closed → closed is NOT allowed", () => {
    expect(canTransition("closed", "closed")).toBe(false);
  });
});

describe("isTerminalStatus", () => {
  const terminalStatuses: A2ATaskStatus[] = ["closed", "failed"];
  const nonTerminalStatuses: A2ATaskStatus[] = ["active", "completing", "waiting-human"];

  test.each(terminalStatuses)("%s is terminal", (status) => {
    expect(isTerminalStatus(status)).toBe(true);
  });

  test.each(nonTerminalStatuses)("%s is not terminal", (status) => {
    expect(isTerminalStatus(status)).toBe(false);
  });
});
