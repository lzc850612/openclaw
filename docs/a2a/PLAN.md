# A2A Federation: Milestone Plan

Status legend: ☐ not started · ⏳ in progress · ✅ done · ❌ blocked

> **Auth deferral note:** Transport authentication (Ed25519 signing, replay prevention, allowlist
> enforcement) is intentionally deferred to Phase 10. Phases 1–9 get the full E2E flow working
> between two trusted, online instances first. Phase 10 then hardens the transport for public
> deployment. Do not add auth checks in earlier phases — they will be introduced wholesale in
> Phase 10 once the core flow is proven.

---

## Phase 1 — Gateway Address and Peer Discovery

Goal: two instances can locate each other by URL and confirm they speak the A2A protocol.
Auth is not part of this phase — the well-known endpoint is public and unauthenticated.

- ✅ **1.1** Add `federation.public_url` and `federation.enabled` config keys
  - Extend config schema (`src/config/`) with `federation.*` block
  - `public_url`: the publicly reachable base URL of this gateway (e.g. `http://localhost:18789`)
  - `enabled`: boolean gate; all A2A routes return 404 if false

- ✅ **1.2** Define `AgentAddress` type
  - File: `src/a2a/address.ts`
  - Fields: `agentId`, `instanceUrl` (the gateway base URL)
  - No DID/keypair needed yet — address is simply `agentId@instanceUrl` for now

- ✅ **1.3** Implement `GET /.well-known/openclaw.json` endpoint
  - File: `src/a2a/gateway-wellknown.ts`
  - Returns: `{ version, instanceUrl, agents: [{ id, capabilities: ["a2a/1.0"] }] }`
  - No public keys in response yet — auth is deferred
  - Wire into HTTP server: `src/gateway/server-a2a.ts`

- ✅ **1.4** Implement peer URL resolution
  - File: `src/a2a/discovery.ts`
  - Fetch and cache remote `/.well-known/openclaw.json`; validate schema
  - Confirm peer supports `a2a/1.0` capability before attempting delivery

- ✅ **1.5** Write tests for Phase 1
  - Unit: well-known response schema validation, capability check
  - Integration: well-known endpoint returns correct data for configured agents; returns 404 when
    federation disabled

---

## Phase 2 — Basic Transport (No Auth)

Goal: an inbound `POST /a2a/message` endpoint accepts messages and delivers them to the local
agent reasoning loop. No signature verification — any caller that can reach the gateway can
deliver. This is intentionally open for dev/test; auth is added in Phase 10.

- ☐ **2.1** Implement `POST /a2a/message` endpoint (no auth)
  - File: `src/a2a/gateway-handler.ts`
  - Validate required fields: `taskId`, `messageId`, `fromInstanceUrl`, `fromAgentId`, `type`,
    `content`
  - Return 400 on missing/malformed fields; 202 on success
  - Log all inbound messages at debug level (taskId, fromAgent, type)

- ☐ **2.2** Register plugin HTTP routes in gateway
  - `src/gateway/server-a2a.ts`: add `POST /a2a/message` and `GET /.well-known/openclaw.json`
  - Routes active only when `federation.enabled = true`

- ☐ **2.3** Implement outbound HTTP POST (no signing)
  - File: `src/a2a/message-queue.ts` (stub — full retry in Phase 3)
  - Simple fetch POST to `<peerInstanceUrl>/a2a/message`; log success/failure

- ☐ **2.4** Write tests for Phase 2
  - Unit: request validation (missing fields, malformed types)
  - Integration: POST returns 202; missing fields return 400; routes absent when federation disabled

---

## Phase 3 — Task Lifecycle and Reliable Delivery

Goal: tasks are durable, survive restarts, and messages are delivered reliably with retry.

- ☐ **3.1** Define `A2ATask` and `A2AMessage` types
  - File: `src/a2a/task-store.ts`
  - Task fields: `id`, `status`, `initiatorInstanceUrl`, `initiatorAgentId`,
    `participantInstanceUrl`, `participantAgentId`, `goal`, `transcript`, `gates`,
    `callbackSessionKey`, `callbackAgentId`, `createdAt`, `updatedAt`, `expiresAt`
  - Message fields: `id`, `taskId`, `type`, `fromInstanceUrl`, `fromAgentId`, `content`,
    `sentAt`, `ackedAt`, `retryCount`

- ☐ **3.2** Implement task store (persist/load/update)
  - Storage: `~/.openclaw/agents/<agentId>/a2a/<taskId>.json`
  - Operations: `create`, `load`, `patchStatus`, `appendMessage`, `listInProgress`, `listAll`
  - `listAll` is needed by the monitor dashboard (Phase 4)

- ☐ **3.3** Implement task state machine
  - File: `src/a2a/task-state.ts`
  - Valid transitions: `active → completing → closed`, `active → waiting-human → active`,
    `active → failed`, `completing → failed`
  - Reject and log invalid transitions

- ☐ **3.4** Upgrade outbox to persistent queue with retry
  - File: `src/a2a/message-queue.ts` (replace Phase 2 stub)
  - Persistent outbox: write message to disk before first send attempt
  - Retry with exponential backoff using `src/infra/retry.ts`
  - Idempotency: receiver returns 202 on duplicate `messageId`; sender marks delivered on any 2xx

- ☐ **3.5** Implement startup restart-catchup
  - On gateway startup: load all `active` and `completing` tasks
  - Re-enqueue any outbox messages not yet ACKed

- ☐ **3.6** Wire inbound message to agent dispatch
  - On valid inbound: store in task transcript, call `dispatchAgentHook` with
    `sessionKey: "a2a:<taskId>"`, `agentId`, `channel: "openclaw-peer"`, `message: <content>`

- ☐ **3.7** Implement `a2a:` session key helpers
  - File: `src/a2a/session-keys.ts`
  - `isA2ASessionKey(key)`, `parseA2ATaskId(key)`, `buildA2ASessionKey(taskId)`
  - Extend `src/sessions/session-key-utils.ts` to recognise the `a2a:` prefix

- ☐ **3.8** Implement `a2a_start_task` agent tool
  - Available to agents in all channels (not A2A-specific)
  - Parameters: `remoteInstanceUrl`, `remoteAgentId`, `goal`, `message`
  - Resolves peer via discovery (Phase 1.4), creates task on disk, enqueues first message,
    returns `{ taskId }` immediately

- ☐ **3.9** Write tests for Phase 3
  - Unit: task store CRUD, state machine transitions, outbox enqueue/dequeue/retry
  - Integration: message sent → stored → delivered → ACKed; restart resumes pending delivery
  - E2E: two gateway instances exchange a single message; both reflect correct task state

---

## Phase 4 — Monitor Dashboard

Goal: a live browser dashboard shows every A2A task and its message thread, with inbound and
outbound messages clearly distinguished by color. This is a dev/ops tool built early so that
every subsequent phase can be debugged visually.

### What it looks like

```
┌─────────────────────────────────────────────────────────────────────┐
│  OpenClaw A2A Monitor                          [auto-refresh: on]   │
├──────────────────┬──────────────────────────────────────────────────┤
│  TASKS           │  task-abc123  •  active  •  peer: localhost:18790 │
│                  │  goal: book a meeting with B                      │
│  ● task-abc123   ├──────────────────────────────────────────────────┤
│    active        │  ▶  10:02:01  [OUT] message                      │
│                  │     "My principal would like to schedule..."      │
│  ○ task-def456   │                                                   │
│    closed        │  ◀  10:02:03  [IN]  message                      │
│                  │     "My principal has 2pm, 3pm, 4pm open..."      │
│                  │                                                   │
│                  │  ▶  10:02:05  [OUT] message                      │
│                  │     "3pm works. Shall we confirm?"                │
│                  │                                                   │
│                  │  ◀  10:02:07  [IN]  completing                   │
│                  │     "Confirmed: 3pm Tuesday."                     │
│                  │                                                   │
│                  │  ▶  10:02:07  [OUT] completed                    │
│                  │     (handshake close)                             │
└──────────────────┴──────────────────────────────────────────────────┘
```

Colors: outbound (▶) in **blue**, inbound (◀) in **green**, status changes in **yellow**,
errors in **red**. Message type badges (`message`, `completing`, `completed`, `error`) shown
inline. Closed/failed tasks shown in muted tone.

### Implementation approach

Served entirely from the gateway as two new routes in the A2A plugin HTTP handler — no separate
build step, no framework. The dashboard is a single self-contained HTML file with inline CSS and
vanilla JS. Data comes from a JSON API that reads the task store on disk.

- ☐ **4.1** Add `GET /a2a/tasks` JSON API endpoint
  - File: `src/a2a/monitor-api.ts`
  - Returns: array of all tasks (all statuses) with summary fields: `id`, `status`,
    `peerInstanceUrl`, `peerAgentId`, `goal`, `messageCount`, `lastActivityAt`
  - Register as a plugin HTTP route alongside `POST /a2a/message`

- ☐ **4.2** Add `GET /a2a/tasks/:taskId` JSON API endpoint
  - Returns: full task record including `transcript` (all messages with `type`, `fromInstanceUrl`,
    `fromAgentId`, `content`, `sentAt`, `ackedAt`) and `gates`
  - Direction derived from `fromInstanceUrl`: matches local instance URL → outbound, else → inbound

- ☐ **4.3** Implement dashboard HTML page at `GET /a2a/monitor`
  - File: `src/a2a/monitor-ui.ts` (returns a static HTML string; no build tooling)
  - Two-panel layout: task list on left, message thread on right
  - Task list: click to select; active tasks highlighted; status badge colored by state
  - Message thread:
    - Outbound messages (▶): blue background/border, right-aligned label
    - Inbound messages (◀): green background/border, left-aligned label
    - `completing` / `completed` messages: yellow accent, labeled with type badge
    - `error` messages: red accent
    - Status change events (e.g. `waiting-human`, `closed`): full-width yellow banner
    - Timestamp shown on every row
  - Auto-refresh: polls `GET /a2a/tasks` and the selected task every 2 seconds
  - No WebSocket or bundler required — plain `setInterval` + `fetch`

- ☐ **4.4** Wire monitor routes into gateway HTTP server
  - `src/gateway/server-a2a.ts`: register `GET /a2a/tasks`, `GET /a2a/tasks/:taskId`,
    `GET /a2a/monitor`
  - All three routes return 404 when `federation.enabled = false`
  - No auth on monitor in dev mode; Phase 10 adds gateway-token gating

- ☐ **4.5** Write tests for Phase 4
  - Unit: `GET /a2a/tasks` returns correct summary shape; `GET /a2a/tasks/:id` returns full
    transcript; direction derived correctly from `fromInstanceUrl`
  - Integration: dashboard HTML page is served and contains expected structure; auto-refresh
    picks up new messages added to a task

---

## Phase 5 — Two-Phase Completion Handshake

Goal: task closure is explicit and bilateral; both sides confirm before callbacks fire.

- ☐ **5.1** Add `completing` and `completed` message types to protocol
  - Extend `A2AMessageType`: `"message" | "completing" | "completed" | "error"`
  - Update message store to record `type` alongside `content`

- ☐ **5.2** Implement `send_completing(result)` agent tool
  - Sends `{ type: "completing", content: result }` to peer via outbox
  - Sets local task status to `completing`

- ☐ **5.3** Handle inbound `completing` on receiver side
  - Dispatch to agent reasoning loop so agent does its final processing
  - After loop ends: automatically send `{ type: "completed" }` and set local task status to
    `closed`

- ☐ **5.4** Handle inbound `completed`
  - Set local task status to `closed`
  - Trigger completion callbacks (Phase 7)

- ☐ **5.5** Handle simultaneous close
  - Both sides send `completing` at the same time
  - Whichever receives the peer's `completing` first: send `completed`, set `closed`
  - `completing` arriving on an already-`closed` task: respond `completed`, no further state change

- ☐ **5.6** Implement TTL enforcement
  - Background check: tasks stuck in `completing` past `expiresAt` are force-closed as `failed`

- ☐ **5.7** Write tests for Phase 5
  - Unit: state machine handles all completing/completed transitions
  - Integration: normal close; simultaneous close; TTL expiry
  - Visual check: monitor dashboard shows completing/completed messages in yellow; closed task
    shown in muted tone

---

## Phase 6 — Human-in-the-Loop (HumanGate)

Goal: agents can pause negotiations, notify their principal, and resume on reply without losing
state.

- ☐ **6.1** Define `HumanGate` type and storage within task record
  - Fields: `id`, `taskId`, `agentId`, `question`, `notifiedChannel`, `notifiedTarget`,
    `status` (`"pending" | "answered"`), `answer`, `createdAt`, `answeredAt`, `timeoutMs`

- ☐ **6.2** Implement `create_human_gate(question)` agent tool
  - Sets `task.status = "waiting-human"`, writes gate to task record
  - Does NOT send a reply to the remote agent (peer waits silently — no retry triggered)
  - Sends proactive notification to the principal via their primary channel

- ☐ **6.3** Implement gate recognition in inbound channel routing
  - Before dispatching a human reply to the agent loop, check for an open `HumanGate` on that
    session
  - If found: mark gate `answered`, resume task via `CronService.wake()`

- ☐ **6.4** Implement task resume after gate answered
  - File: `src/a2a/resume.ts`
  - `dispatchAgentHook(sessionKey: "a2a:<taskId>", message: <gate-answer-with-context>)`

- ☐ **6.5** Implement HumanGate rate limiting
  - Max N open gates per task (`federation.maxGatesPerTask`, default 5)
  - Exceeding limit fails the task with `"too many human escalations"`

- ☐ **6.6** Expose open gates in monitor dashboard
  - `GET /a2a/tasks/:taskId` already returns `gates` array
  - Dashboard renders open gates as a full-width yellow banner in the thread:
    `⏸ waiting for human: "<question>"  [pending since 10:03:12]`
  - Answered gates shown in muted tone with the answer text

- ☐ **6.7** Write tests for Phase 6
  - Unit: gate creation, gate recognition in routing, resume dispatch
  - Integration: agent opens gate → human replies → task resumes → negotiation continues
  - Edge: max gates exceeded; gate timeout

---

## Phase 7 — Completion Callbacks and Human Notification

Goal: after a task closes, both principals are notified on their own channels.

- ☐ **7.1** Implement callback dispatch on task closed (initiator side)
  - When task reaches `closed`: `dispatchAgentHook(sessionKey: task.callbackSessionKey, ...)`
  - Agent generates a human-readable summary and delivers it to PersonA via their original channel

- ☐ **7.2** Implement principal notification on task closed (participant side)
  - When task reaches `closed` on the participant's side: deliver proactive message to PersonB
  - Primary channel resolved from agent config or last active session

- ☐ **7.3** Write tests for Phase 7
  - Integration: task closes → initiator notifies PersonA → participant notifies PersonB
  - Edge: callback session no longer valid; primary channel not configured

---

## Phase 8 — Agent Cognitive Model

Goal: agents in A2A sessions act as representatives of their principals, not as assistants to
the remote party.

- ☐ **8.1** Extend `ChannelAgentPromptAdapter` with `sessionContext`
  - File: `src/channels/plugins/types.core.ts`
  - Add: `sessionContext?: (params: { cfg, accountId, sessionMeta: unknown }) => string | null`

- ☐ **8.2** Implement A2A system prompt context block
  - File: `extensions/openclaw-peer/src/agent-prompt.ts`
  - `sessionContext` returns the operating-mode block: principal identity, counterparty identity,
    goal, negotiation rules
  - `messageToolHints` returns A2A-specific tool hints

- ☐ **8.3** Implement per-message sender context injection
  - In the A2A inbound dispatcher, prepend a gateway-injected header to every message before the
    agent sees it: `[A2A | From: <agentId>@<instanceUrl> | Round: N | Task: <taskId>]`
  - Header is constructed from trusted transport data, not from message content

- ☐ **8.4** Implement A2A-specific agent tools
  - File: `extensions/openclaw-peer/src/agent-tools.ts`
  - `get_principal_calendar_slots(date_range)` — stub; interface defined for integration later
  - `get_principal_preferences(topic)` — stub
  - `get_standing_rules()` — reads from agent config/rules file
  - `create_human_gate(question)` — delegates to Phase 6
  - `send_completing(result)` — delegates to Phase 5

- ☐ **8.5** Implement A2A-specific tool policy
  - A2A sessions: no shell execution, no file system access outside agent dir, unless principal
    explicitly configures otherwise

- ☐ **8.6** Write tests for Phase 8
  - Unit: `sessionContext` produces correct block for a given task record; per-message header
    injected correctly
  - Integration: agent in A2A session queries tools rather than asking human questions

---

## Phase 9 — Channel Plugin (`extensions/openclaw-peer`)

Goal: remote agents appear as a first-class channel in OpenClaw's channel system.

- ☐ **9.1** Create `extensions/openclaw-peer` workspace package
  - `package.json`, `tsconfig.json`, `vitest.config.ts`
  - Entry: `src/index.ts` registers the channel plugin

- ☐ **9.2** Implement `ChannelPlugin` for `openclaw-peer`
  - `id: "openclaw-peer"`
  - `config`: reads `federation.*` config keys
  - `messaging`: delegates to task store and outbox
  - `agentPrompt`: implements `sessionContext` and `messageToolHints`
  - `agentTools`: registers A2A-specific tools
  - `status`: reports active/failed/waiting tasks per peer
  - Note: `security` adapter (allowlist enforcement) is added in Phase 10

- ☐ **9.3** Add `openclaw-peer` to channel registry and labeler
  - `src/channels/registry.ts`: add channel id
  - `.github/labeler.yml`: add label rule

- ☐ **9.4** Write tests for Phase 9
  - Unit: channel plugin adapter methods return correct results
  - Integration: plugin registers routes; routes accessible on running gateway

---

## Phase 10 — Transport Authentication

Goal: harden the transport for public deployment. All unauthenticated assumptions from earlier
phases are replaced with cryptographic verification.

- ☐ **10.1** Implement Ed25519 sign/verify helpers
  - File: `src/a2a/signing.ts`
  - Sign: `method + path + timestamp + messageId + taskId + body-hash`
  - Verify: same computation against sender's public key

- ☐ **10.2** Extend `/.well-known/openclaw.json` with public keys
  - Add `publicKey` (base64 Ed25519) per agent entry in the well-known response
  - Update `src/a2a/discovery.ts` to cache public keys alongside gateway URL

- ☐ **10.3** Add signature verification to `POST /a2a/message`
  - Read `X-A2A-*` headers: `Sender-Agent`, `Timestamp`, `Message-Id`, `Signature`
  - Verify signature; reject with 401 on failure
  - Enforce replay window (±30s on `Timestamp`); reject with 401 on violation

- ☐ **10.4** Add allowlist enforcement
  - `federation.allowedPeers`: list of `{ instanceUrl }` entries
  - Reject inbound from unlisted instances with 403
  - Add `security` adapter to the `openclaw-peer` channel plugin (Phase 9.2)
  - Add `openclaw doctor` warning when allowlist is empty and federation is enabled

- ☐ **10.5** Add outbound signing
  - Sign every outgoing A2A request with the local agent's Ed25519 private key
  - Attach `X-A2A-*` headers on all outbound POSTs

- ☐ **10.6** Gate monitor dashboard behind gateway token
  - `GET /a2a/tasks`, `GET /a2a/tasks/:id`, `GET /a2a/monitor` require
    `Authorization: Bearer <gateway-token>` when auth is enabled
  - Dashboard prompts for token on first load; stores in `sessionStorage`

- ☐ **10.7** Write tests for Phase 10
  - Unit: signing round-trip; replay window enforcement
  - Integration: endpoint rejects bad/missing signatures; replayed messages rejected;
    unlisted sender rejected; valid signed request accepted end-to-end

---

## Phase 11 — Discovery (DNS + Registry)

Goal: agents can find each other without knowing the gateway URL in advance.

- ☐ **11.1** Implement DNS SRV lookup
  - `_openclaw._tcp.<domain>` SRV record → gateway host + port
  - Integrate with `src/a2a/discovery.ts`

- ☐ **11.2** Implement registry client (optional, operator-run)
  - `POST /registry/announce`: register instanceUrl + public key
  - `GET /registry/{agentId}`: resolve agentId to instanceUrl
  - Client code in `src/a2a/discovery.ts`

- ☐ **11.3** Write tests for Phase 11
  - Unit: DNS SRV parsing; registry request construction
  - Integration: mock DNS resolves to gateway; mock registry returns correct URL

---

## Phase 12 — CLI and Hardening

Goal: operators can inspect tasks from the terminal and the system survives chaos conditions.

- ☐ **12.1** Add `openclaw a2a list` CLI command
  - Lists all tasks: id, status, peer, goal, last activity

- ☐ **12.2** Add `openclaw a2a status <taskId>` CLI command
  - Full task detail: transcript, gate history, delivery status, error if failed

- ☐ **12.3** Add A2A task summary to `openclaw channels status`

- ☐ **12.4** Load and chaos testing
  - Network partition mid-negotiation: tasks pause and resume
  - Simultaneous close from both sides
  - Gateway restart mid-negotiation: tasks resume from persisted state

- ☐ **12.5** Write tests for Phase 12
  - Integration: CLI commands output correct data for known task states
  - E2E: full meeting-booking scenario across two real gateway instances

---

## Phase Dependencies

```
Phase 1 (Discovery)
  └─► Phase 2 (Basic Transport)
        └─► Phase 3 (Task + Delivery)
              └─► Phase 4 (Monitor Dashboard)   ← visibility unlocked here
                    ├─► Phase 5 (Completion Handshake)
                    │     └─► Phase 7 (Human Notification)
                    ├─► Phase 6 (HumanGate)
                    │     └─► Phase 7
                    └─► Phase 8 (Cognitive Model)
                          └─► Phase 9 (Channel Plugin)
                                └─► Phase 10 (Auth)
                                      └─► Phase 11 (Discovery++)
                                            └─► Phase 12 (CLI + Hardening)
```

Phases 5, 6, and 8 can be developed in parallel once Phase 4 is complete.
Phase 10 is a self-contained hardening phase that wraps around the Phase 2 transport.
