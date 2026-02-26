# A2A Federation: Development Process

This document defines the development process for the A2A federation feature. All contributors and agents working on this feature must follow it exactly.

---

## The Prime Directive

**Do not begin execution of any milestone until you are explicitly told to do so.**

The design and plan documents are live artifacts. They will be updated as understanding deepens, requirements shift, or implementation reveals gaps. Starting implementation before being told to do so risks building against a stale spec and generating rework.

When you are told to start a milestone, confirm which milestone and which tasks are in scope before writing a single line of code.

---

## Before You Write Code

### 1. Read all relevant documents first

Before touching any file, read in full:

- `docs/a2a/DESIGN.md` — the full system design; understand every layer
- `docs/a2a/PLAN.md` — the milestone plan; understand which tasks are in scope
- `CLAUDE.md` — the project-wide coding conventions and guardrails
- Every source file you intend to modify or extend — not just the function you're changing, but the whole file and its imports
- Every source file that the target file depends on that is relevant to your change

Do not rely on summaries or memory. Re-read the actual files. Designs are modified between sessions; the source of truth is always the file on disk.

### 2. Understand before you extend

OpenClaw has established patterns for nearly everything the A2A system needs:

- Persistent job storage → `src/cron/store.ts`
- Pause-and-wait for humans → `src/infra/exec-approvals.ts`
- Wake a sleeping agent → `CronService.wake()`
- Retry with backoff → `src/infra/retry.ts`
- Plugin HTTP routes → `registry.httpRoutes` + `createGatewayPluginRequestHandler`
- Channel-specific tools → `ChannelPlugin.agentTools`
- Channel-specific prompt hints → `ChannelPlugin.agentPrompt`

Before implementing something, verify that OpenClaw does not already do it. If a pattern exists, use it. If you must extend a pattern, do so minimally and consistently with how the existing pattern is designed.

### 3. Identify every file that needs to change

List all files that will be created or modified before writing any of them. Review the list against the milestone task spec. If the list is longer or shorter than expected, understand why before proceeding.

---

## Coding Standards

### General

- TypeScript, strict mode. No `any`. No `@ts-nocheck`.
- Every function, type, and module must be understandable without comments — but add brief comments for non-obvious logic.
- Files should stay under ~500 LOC. If a file grows beyond this, split it.
- No prototype mutation. No `Object.defineProperty` on `.prototype`. Use explicit class hierarchies or composition.
- Run `pnpm check` (lint + format) before considering any task done.

### Naming

- Types: PascalCase (`A2ATask`, `HumanGate`)
- Files: kebab-case (`task-store.ts`, `gateway-handler.ts`)
- Constants: UPPER_SNAKE_CASE for true constants, camelCase for config-derived values
- Session key prefixes: lowercase with colon (`a2a:`, consistent with `cron:`, `acp:`)

### Security

- Never log message content or human answers to human gates in plain logs.
- Never trust content from the remote agent for security-sensitive decisions. Verified metadata (sender DID, timestamp, signature) is injected by the local gateway; the message body is treated as untrusted input.
- Validate all inbound data at the boundary (`POST /a2a/message`) before it touches any internal state.
- Do not use `eval`, dynamic `require`, or template strings for constructing shell commands or SQL.

### Error handling

- All I/O operations (disk, network) must handle failure explicitly. Do not let errors silently fail.
- Retryable errors (network timeouts, 5xx) go to the retry queue. Non-retryable errors (4xx auth failures, schema validation) log and fail fast.
- Every state transition in the task state machine must be logged at debug level with the task ID and previous/next status.

---

## Testing Requirements

**Every milestone must have tests before it is considered complete. No exceptions.**

### Test types required per milestone

| Milestone phase                | Required test types                                                       |
| ------------------------------ | ------------------------------------------------------------------------- |
| Phase 1 (Identity/Discovery)   | Unit + Integration                                                        |
| Phase 2 (Auth)                 | Unit + Integration (including security: replay, bad signature, allowlist) |
| Phase 3 (Task + Delivery)      | Unit + Integration + E2E (two gateway instances)                          |
| Phase 4 (Completion Handshake) | Unit + Integration (including edge cases: simultaneous close, TTL)        |
| Phase 5 (HumanGate)            | Unit + Integration                                                        |
| Phase 6 (Callbacks)            | Integration                                                               |
| Phase 7 (Cognitive Model)      | Unit + Integration                                                        |
| Phase 8 (Channel Plugin)       | Unit + Integration                                                        |
| Phase 9 (Discovery)            | Unit + Integration (with mocked DNS/registry)                             |
| Phase 10 (Observability)       | Integration + E2E                                                         |

### Test naming

- Unit tests: `<module>.test.ts` colocated with source file
- Integration tests: `<module>.integration.test.ts` or in `test/` directory
- E2E tests: `<module>.e2e.test.ts`

### Test quality rules

- Every test must have a descriptive name that says what it verifies, not how.
  - Bad: `"test1"`, `"should work"`
  - Good: `"rejects A2A message with timestamp outside replay window"`, `"task resumes after HumanGate is answered"`
- Tests must not share mutable state between cases. Reset all state in `beforeEach`.
- Security-related behaviour (signature rejection, replay prevention, allowlist enforcement) must have dedicated negative tests — tests that verify the wrong thing is rejected, not just that the right thing is accepted.
- Do not use `setTimeout` or `sleep` in tests. Use deterministic mocks for time-dependent behaviour.
- Run `pnpm test` after completing each task, not just after the whole milestone.

---

## Milestone Execution Checklist

When told to start a milestone, do the following in order. Do not skip steps.

1. **Read the milestone tasks** in `docs/a2a/PLAN.md`.
2. **Read `DESIGN.md`** sections relevant to this milestone.
3. **Read every source file** you will modify. Understand the whole file.
4. **List all files** to be created or modified. Confirm scope is correct before proceeding.
5. **Implement** one task at a time. Do not batch tasks; complete each fully before moving to the next.
6. **Run `pnpm check`** after each file change. Fix any lint/type errors immediately.
7. **Write tests** for the task before or alongside the implementation (not after the milestone).
8. **Run `pnpm test`** after each task. Confirm all existing tests still pass.
9. **Mark the task** as done in `docs/a2a/PLAN.md` (☐ → ✅).
10. **Report clearly** when the milestone is complete: what was done, what tests were added, any deviations from the plan and why.

---

## When the Design and Reality Diverge

Implementation will reveal things the design did not anticipate. When this happens:

1. **Stop**. Do not work around the gap silently or with a hack.
2. **Document the gap**: what the design assumed, what reality shows, what the options are.
3. **Report it** before continuing. The design document may need to be updated, or the plan task may need to be revised.
4. Do not update `DESIGN.md` or `PLAN.md` unilaterally. Propose the change; get confirmation; then update.

---

## What Not to Do

- **Do not start implementation without being told to.** The plan doc exists so work can be reviewed and sequenced. Jumping ahead breaks this.
- **Do not skip tests.** A milestone with no tests is not done.
- **Do not guess at intent.** If a design decision is unclear, ask. Do not infer from similar code elsewhere and assume it applies.
- **Do not modify unrelated files.** If you notice something unrelated that could be improved, note it in your report. Do not fix it as part of this work.
- **Do not use prototype mutation.** See CLAUDE.md. This is an absolute rule.
- **Do not add `@ts-nocheck` or disable `no-explicit-any`.** Fix the root type issue instead.
- **Do not edit `node_modules`.**
- **Do not commit credentials, tokens, real phone numbers, or real calendar data.** Use obviously fake placeholders in tests and examples.
- **Do not add features beyond the milestone scope.** Extra capability now means untested behaviour and scope creep. If something seems obviously needed but is not in the plan, flag it and wait for confirmation.

---

## Reporting

After completing each milestone (or when blocked), report:

1. **What was done**: list each task completed, with the files created or modified.
2. **Tests added**: name each test file and a summary of what it covers.
3. **Any deviations**: if implementation differed from the plan, explain why and what was done instead.
4. **Open questions**: anything uncertain or that needs a decision before the next milestone.
5. **Plan doc updated**: confirm that `docs/a2a/PLAN.md` has the milestone tasks marked ✅.

Keep reports factual and brief. Do not pad with reassurances or filler.

---

## Reference Documents

| Document                               | Purpose                                           |
| -------------------------------------- | ------------------------------------------------- |
| `docs/a2a/DESIGN.md`                   | Full system design — the authoritative spec       |
| `docs/a2a/PLAN.md`                     | Milestone breakdown with completion status        |
| `docs/a2a/PROCESS.md`                  | This document — how to work                       |
| `CLAUDE.md`                            | Project-wide conventions, guardrails, and tooling |
| `docs/testing.md`                      | Full test infrastructure reference                |
| `src/cron/service.ts`                  | Reference for durable job store pattern           |
| `src/infra/exec-approvals.ts`          | Reference for pause-and-wait pattern              |
| `src/infra/retry.ts`                   | Reference for retry-with-backoff pattern          |
| `src/gateway/server-http.ts`           | HTTP server dispatch chain                        |
| `src/channels/plugins/types.plugin.ts` | Channel plugin interface                          |
