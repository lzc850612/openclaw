import { describe, expect, test } from "vitest";
import { getA2ABlockedTools, isToolBlockedInA2A } from "./tool-policy.js";

describe("getA2ABlockedTools", () => {
  test("bash is blocked", () => {
    expect(getA2ABlockedTools()).toContain("bash");
  });

  test("execute_command is blocked", () => {
    expect(getA2ABlockedTools()).toContain("execute_command");
  });

  test("returns an array", () => {
    expect(Array.isArray(getA2ABlockedTools())).toBe(true);
  });
});

describe("isToolBlockedInA2A", () => {
  test("bash is blocked", () => {
    expect(isToolBlockedInA2A("bash")).toBe(true);
  });

  test("execute_command is blocked", () => {
    expect(isToolBlockedInA2A("execute_command")).toBe(true);
  });

  test("read_file is NOT blocked", () => {
    expect(isToolBlockedInA2A("read_file")).toBe(false);
  });

  test("is case-insensitive for bash (uppercase)", () => {
    expect(isToolBlockedInA2A("BASH")).toBe(true);
  });

  test("is case-insensitive for execute_command (mixed case)", () => {
    expect(isToolBlockedInA2A("Execute_Command")).toBe(true);
  });

  test("is case-insensitive for shell (uppercase)", () => {
    expect(isToolBlockedInA2A("SHELL")).toBe(true);
  });

  test("unknown tool is not blocked", () => {
    expect(isToolBlockedInA2A("some_unknown_tool")).toBe(false);
  });

  test("write_file is blocked", () => {
    expect(isToolBlockedInA2A("write_file")).toBe(true);
  });

  test("delete_file is blocked", () => {
    expect(isToolBlockedInA2A("delete_file")).toBe(true);
  });

  test("create_file is blocked", () => {
    expect(isToolBlockedInA2A("create_file")).toBe(true);
  });
});
