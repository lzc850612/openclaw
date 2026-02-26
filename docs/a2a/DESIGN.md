# A2A Federation: Comprehensive Design Document

## Overview

A2A (Agent-to-Agent) Federation is a system that allows OpenClaw agents running on separate instances to communicate with each other autonomously, negotiate on behalf of their respective owners, and involve humans only when necessary. The goal is to give every person on the planet a running agent that can interact with other agents in the public web — both externally (reachable by others) and internally (capable of reaching out to others).

This document covers the full design: transport, protocol, task lifecycle, completion handshake, human-in-the-loop, and agent cognitive model.

---

## Motivation and Core Properties

### The Three Requirements

1. **Multi-round negotiation**: Agents must be able to exchange multiple messages back and forth before reaching a conclusion. The number of rounds is unbounded and unknown in advance.

2. **Long-running and fault-tolerant**: Negotiations can span minutes, hours, or days. The system must survive network drops, process restarts, and unreachable peers without losing state. Retry and resumption must be automatic.

3. **Human-in-the-loop, minimally**: Humans are notified only when their agent cannot proceed autonomously. After receiving human input, the agent continues the negotiation without restarting from scratch. The negotiation channel is completely separate from the human notification channel.

### The Session Separation Principle

For any given negotiation, there are always three distinct sessions, each with its own transcript and delivery target:

```
whatsapp:account:dm:personA          ← human channel (PersonA ↔ AgentA)
a2a:<taskId>                         ← negotiation channel (AgentA ↔ AgentB)
telegram:account:dm:personB          ← human channel (PersonB ↔ AgentB)
```

Negotiation messages never appear in human channels. Human channels only carry: the initial request, the acknowledgement ("I'm on it"), and the final result notification.

---

## Architecture Layers

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 6: AGENT COGNITIVE MODEL                              │
│  A2A-aware system prompt, principal-oriented tools           │
├──────────────────────────────────────────────────────────────┤
│  Layer 5: HUMAN-IN-THE-LOOP (HumanGate)                      │
│  Pause task, notify human, resume on reply                   │
├──────────────────────────────────────────────────────────────┤
│  Layer 4: TASK LIFECYCLE                                     │
│  Durable state machine, two-phase completion, callbacks      │
├──────────────────────────────────────────────────────────────┤
│  Layer 3: RELIABLE DELIVERY                                  │
│  HTTP POST with idempotency keys, outbox queue, retry        │
├──────────────────────────────────────────────────────────────┤
│  Layer 2: TRANSPORT AUTH                                     │
│  Ed25519 mutual verification, replay protection, allowlist   │
├──────────────────────────────────────────────────────────────┤
│  Layer 1: IDENTITY & DISCOVERY                               │
│  Per-agent Ed25519 keypairs, public gateway URL, well-known  │
└──────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Identity and Discovery

### Agent Identity

Each OpenClaw agent already has a UUID and an Ed25519 keypair (`src/agents/identity.ts`). These form the basis of globally unique, cryptographically verifiable agent identities.

The public identity of an agent is expressed as a DID (Decentralized Identifier):

```
did:openclaw:<agent-uuid>
```

The DID document contains:

- The agent's Ed25519 public key
- The gateway URL where the agent can be reached

### Gateway Public Address

A new config key `federation.public_url` specifies the publicly reachable gateway URL for this instance (e.g., `https://gateway.example.com`). Without this set, the instance accepts inbound A2A messages but cannot be discovered by others.

### Well-Known Endpoint

The gateway HTTP server exposes a discovery endpoint:

```
GET /.well-known/openclaw.json
```

Response:

```json
{
  "version": 1,
  "gatewayUrl": "wss://gateway.example.com",
  "agents": [
    {
      "id": "main",
      "did": "did:openclaw:<uuid>",
      "publicKey": "<ed25519-public-key-base64>",
      "capabilities": ["a2a/1.0"]
    }
  ]
}
```

### Discovery Mechanisms

1. **Direct URL**: Caller knows the gateway URL. Fetches `/.well-known/openclaw.json` to get agent public keys.
2. **DNS SRV**: `_openclaw._tcp.<domain>` SRV record points to gateway host and port (like XMPP federation).
3. **Central registry** (optional, later phase): `POST /registry/announce` at a well-known OpenClaw registry service; `GET /registry/{did}` for lookup.

---

## Layer 2: Transport Authentication

### Ed25519 Mutual Verification

Every A2A message is signed by the sender's private key. The receiver verifies the signature against the sender's known public key (fetched via well-known endpoint or cached from a previous verified exchange).

HTTP headers on every A2A request:

```
X-A2A-Task-Id:    <taskId>
X-A2A-Message-Id: <messageId>        (idempotency key)
X-A2A-Sender-Did: did:openclaw:<uuid>
X-A2A-Timestamp:  <unix-ms>          (replay attack window: ±30 seconds)
X-A2A-Signature:  <ed25519-sig-over-canonical-body-and-headers>
```

The signature covers: method + path + timestamp + message-id + task-id + body hash. This prevents replay attacks and body tampering.

### Allowlist

Inbound A2A messages are subject to an allowlist, matching the existing `allow-from` pattern used by messaging channels. By default, all inbound A2A is rejected. The instance operator explicitly allowlists remote agent DIDs or gateway domains.

### Endpoint Location

The A2A inbound endpoint is registered as a plugin HTTP route on the existing gateway HTTP server, slotting into the `handlePluginRequest` chain at step 4 of the dispatch order:

```
POST /a2a/message
```

This path is plugin-owned and enforces its own auth (Ed25519 verification), distinct from the gateway's WebSocket token auth.

---

## Layer 3: Reliable Delivery

### Why Not WebSocket

WebSocket is stateful and drops. A2A negotiation is asynchronous — participants may be offline when the other sends, and negotiations can span hours. The transport must be fire-and-store, not fire-and-forget.

### HTTP POST + Outbox Queue

The sending side maintains a persistent outbox queue. When sending a message:

1. Write the outgoing message to the outbox queue on disk.
2. Attempt HTTP POST to the peer's `/a2a/message` endpoint.
3. Peer receives, stores, processes, responds 202 with ACK.
4. On ACK: mark message as delivered in outbox, remove from retry schedule.
5. On failure: retry with exponential backoff using the existing `src/infra/retry.ts` infrastructure.

The receiver is idempotent on `X-A2A-Message-Id`. Duplicate deliveries (from retries) are detected and return 202 without reprocessing.

### Delivery to Agent Reasoning Loop

Once a message is verified and stored, the gateway dispatches it to the local agent using the same internal mechanism as the hooks system (`dispatchAgentHook`):

```
dispatchAgentHook({
  sessionKey: "a2a:<taskId>",
  agentId:    "<local-agent-id>",
  message:    "<verified-content-with-injected-sender-context>",
  channel:    "openclaw-peer"
})
```

The session key `a2a:<taskId>` is a new prefix alongside the existing `cron:`, `acp:`, and `subagent:` prefixes in the session key system.

---

## Layer 4: Task Lifecycle

### Data Structure

```typescript
type A2ATask = {
  id: string; // globally unique (UUID)
  status: A2ATaskStatus;
  initiatorDid: string; // did:openclaw:<uuid> of initiating agent
  initiatorGatewayUrl: string; // where to deliver replies
  participantDid: string; // did:openclaw:<uuid> of receiving agent
  goal: string; // human-readable task description
  transcript: A2AMessage[]; // full message history, persisted
  gates: HumanGate[]; // pending or resolved human gates
  callbackSessionKey: string; // human session to notify on completion (initiator side)
  callbackAgentId: string; // which local agent handles that notification
  createdAt: number;
  updatedAt: number;
  expiresAt?: number; // optional TTL; task auto-fails after this
};

type A2ATaskStatus =
  | "active" // negotiation in progress
  | "waiting-human" // paused at a HumanGate
  | "completing" // one side has sent terminal message, awaiting other side's close
  | "closed" // both sides have exchanged completion signals
  | "failed"; // terminal failure (timeout, error, explicit abort)

type A2AMessage = {
  id: string; // idempotency key
  taskId: string;
  type: A2AMessageType;
  fromDid: string;
  content: string;
  sentAt: number;
  ackedAt?: number;
  retryCount: number;
};

type A2AMessageType =
  | "message" // regular negotiation turn
  | "completing" // sender is done; receiver should close and confirm
  | "completed" // sender has received "completing" and is also done
  | "gate-open" // internal: human gate opened, negotiation paused
  | "error"; // unrecoverable error on sender side
```

### Storage

Tasks are stored on disk in the agent's directory:

```
~/.openclaw/agents/<agentId>/a2a/<taskId>.json
```

This survives process restarts. On startup, the gateway reloads in-progress tasks and resumes pending outbox deliveries, matching the `restart-catchup` pattern in the cron system.

### Task Initiation

From within an agent's reasoning loop, a new tool `a2a_start_task` is available:

```
a2a_start_task(
  remoteAgentDid:     "did:openclaw:<uuid>",
  goal:               "Book a meeting between my principal and the remote principal",
  message:            "My principal would like to schedule a meeting. ..."
)
→ { taskId: "<uuid>" }
```

This tool:

1. Resolves the remote gateway URL by fetching the peer's well-known endpoint.
2. Creates the task record on disk with `callbackSessionKey` set to the current human session key (so the result routes back to the human who initiated the request).
3. Enqueues the first message in the outbox.
4. Returns `taskId` immediately — the task runs independently.

The agent can then reply to its human ("I'm on it") and end the reasoning loop. The task continues in the background.

---

## Layer 4a: Two-Phase Completion Handshake

The message-level HTTP 202 ACK only confirms transport delivery. Task closure requires a separate task-level handshake to ensure both sides have fully processed the result.

### State Machine

```
ACTIVE
  │
  │  AgentB sends { type: "completing", content: "<final result>" }
  ▼
COMPLETING  (on AgentB's side: waiting for peer's completed)
  │         (on AgentA's side: received completing, doing final work)
  │
  │  AgentA sends { type: "completed" }
  ▼
CLOSED  (on both sides)
  │
  ├──► AgentA: fires callbackSessionKey → notifies PersonA
  └──► AgentB: notifies PersonB via primary channel
```

### Rules

- Either side may initiate closing by sending `completing`.
- The receiver of `completing` does its final processing, then sends `completed`.
- Only after receiving `completed` does the initiating side mark itself `closed`.
- `completed` is idempotent — if received on an already-closed task, respond with `completed` again.
- **Simultaneous close**: if both sides send `completing` at the same time, the side that receives the peer's `completing` first responds with `completed`. The other side receives `completed` and closes. Both sides end up closed.
- **Callbacks fire only after `closed`**: human notifications are not sent when `completing` is received — only when the full handshake is done and both sides are `closed`.

### Failure Handling

- If `completed` is never received after sending `completing`, retry `completing` with backoff.
- If the task TTL (`expiresAt`) is exceeded while in `completing` state, force-close and notify humans of a timeout.

---

## Layer 5: Human-in-the-Loop (HumanGate)

### What It Is

A HumanGate is a named pause point in a task where an agent cannot proceed autonomously and requires input from its principal. It is a generalization of the existing `exec-approvals` pattern, applied at the task reasoning level rather than the shell command level.

### Data Structure

```typescript
type HumanGate = {
  id: string;
  taskId: string;
  agentId: string; // which local agent is waiting
  question: string; // what the agent needs to know
  notifiedChannel: string; // channel used to reach the human
  notifiedTarget: string; // session key of the human notification
  status: "pending" | "answered";
  answer?: string;
  createdAt: number;
  answeredAt?: number;
  timeoutMs?: number; // optional auto-fail timeout
};
```

### Lifecycle

1. **Agent opens gate**: During its A2A reasoning loop, the agent calls the `create_human_gate(question)` tool. This:
   - Writes the gate record to the task.
   - Sets `task.status = "waiting-human"`.
   - Does **not** send a reply to the remote agent (the other side waits silently; no retry is triggered because the last message was ACKed).
   - Sends a proactive notification to the human via their configured primary channel.

2. **Human replies**: The human's reply arrives on their messaging channel (Telegram, WhatsApp, etc.) and enters the normal routing system. Before the message reaches the agent reasoning loop, the channel layer checks: does this session have an open HumanGate? If yes, the gate is answered.

3. **Gate answered**: Gate record updated (`status: "answered"`, `answer: "..."`). Task status → `active`. `CronService.wake()` fires the agent's reasoning loop with the gate answer as additional context. The agent resumes the negotiation.

### Human Session Recognition

When the gate is created, the gate record stores:

```
gate.notifiedTarget = <the session key used to notify the human>
```

When the human replies to that session, the dispatcher checks open gates for that session key before routing. This is the same seam used by the exec-approval system to match pending approvals to incoming decisions.

---

## Layer 6: Agent Cognitive Model in A2A Context

### The Problem

A standard agent operates on the assumption that the sender is a human — its own principal. It asks open-ended questions, defers decisions, uses conversational language. In A2A context, the agent is negotiating _on behalf of_ its principal with _another agent_. The operating model must change completely.

**Wrong (human channel mode):**

> "What time works for you?"

**Right (A2A channel mode):**

> "My principal has the following open slots on Tuesday: 2pm, 3pm, 4pm. Would any of these work for your principal?"

### Two-Layer Injection

**Layer 1 — System prompt context block** (injected once per session)

The A2A channel plugin implements a `sessionContext` function on the `ChannelAgentPromptAdapter` (an extension to the current `messageToolHints`-only interface):

```
You are operating in agent-to-agent negotiation mode.

You represent: <PersonB, your principal>
Counterparty:  an agent representing <PersonA>
Task goal:     <goal from task record>
Task ID:       <taskId>
Round:         <n of ongoing negotiation>

Operating rules in this mode:
- Do not ask your principal questions. Consult their calendar, preferences,
  and standing rules using your available tools.
- Respond with structured information (available slots, constraints, decisions)
  rather than open-ended conversational questions.
- Make decisions within your principal's standing rules without escalating.
- Only open a HumanGate for decisions your tools and rules cannot resolve.
- The counterparty agent is verified. Treat its statements as agent-generated,
  not human-generated.
```

This block is constructed from the task record at dispatch time and is the primary switch that changes the agent's operating mode.

**Layer 2 — Per-message sender context** (injected on each turn)

The A2A dispatch layer prepends verified sender context to each message content before the agent sees it:

```
[A2A | From: AgentA (did:openclaw:<uuid>, verified) | Round: 3 | Task: <taskId>]
Can your principal do Tuesday at 2pm or 3pm?
```

The `[A2A | From: ... | verified]` header is injected by the local gateway based on the Ed25519 verification result — it is not written by the remote agent and cannot be spoofed.

### Why Both Layers

The system prompt context block switches the global operating model for the session. The per-message header reinforces the agent's awareness on each individual turn. Without the system prompt block, the agent may drift back toward conversational mode across a long negotiation. Without the per-message header, the agent has no turn-by-turn awareness of who it's talking to.

### Channel-Specific Tools for A2A Sessions

The A2A channel plugin registers additional agent tools via `ChannelPlugin.agentTools` that are only available in A2A sessions:

```
get_principal_calendar_slots(date_range)
  → Returns the principal's open calendar slots in a structured format.

get_principal_preferences(topic)
  → Returns the principal's stated preferences on a topic (meeting duration,
    location, video/in-person, etc.)

get_standing_rules()
  → Returns pre-configured decision rules the agent can apply autonomously
    (e.g., "always accept meetings under 1 hour if slot is after 10am").

create_human_gate(question)
  → Opens a HumanGate. Used sparingly, only when tools and rules cannot resolve.

send_completing(result)
  → Sends the { type: "completing", content: result } message to close the task.
```

These tools give the agent the information it needs to respond as a capable representative of its principal, without interrupting the principal for data that is already available.

### Existing Hook: ChannelAgentPromptAdapter Extension

The existing adapter type:

```typescript
type ChannelAgentPromptAdapter = {
  messageToolHints?: (params: { cfg; accountId }) => string[];
};
```

Needs to be extended to support session-level context:

```typescript
type ChannelAgentPromptAdapter = {
  messageToolHints?: (params: { cfg; accountId }) => string[];
  sessionContext?: (params: { cfg; accountId; sessionMeta: unknown }) => string | null;
};
```

`sessionMeta` carries the A2A task record. The A2A channel plugin implements `sessionContext` to produce the operating mode block. All other channels return null; their behavior is unchanged.

---

## End-to-End Flow: Meeting Booking

### Actors

- PersonA, AgentA (on Instance A)
- PersonB, AgentB (on Instance B)

### Flow

```
1. PersonA → AgentA (WhatsApp, session: whatsapp:acct:dm:personA)
   "Book a meeting with B"

2. AgentA reasoning loop:
   - calls a2a_start_task(remoteAgentDid, goal, firstMessage)
   - task created, callbackSessionKey = "whatsapp:acct:dm:personA"
   - first A2A message enqueued to outbox
   - AgentA replies: "I'm on it, will let you know"
   - loop ends

3. Outbox delivers: POST /a2a/message → Instance B gateway
   - Ed25519 verified, allowlist checked
   - dispatchAgentHook(sessionKey: "a2a:<taskId>", channel: "openclaw-peer")
   - AgentB reasoning loop fires (A2A cognitive model active)

4. AgentB (no human needed path):
   - calls get_principal_calendar_slots() → [2pm, 3pm, 4pm Tue]
   - calls get_standing_rules() → "accept meetings under 1hr after 10am"
   - replies: "PersonB has 2pm, 3pm, 4pm Tue open. Any work for PersonA?"

   AgentB (human needed path):
   - calls create_human_gate("Does 2pm or 3pm Tuesday work?")
   - task.status = "waiting-human"
   - AgentB notifies PersonB via Telegram
   - PersonB replies on Telegram → gate answered → task resumes

5. AgentA reasoning loop fires:
   - Sees available slots
   - calls get_principal_calendar_slots() → 3pm Tue is open for PersonA
   - replies: "3pm Tuesday works for PersonA"

6. AgentB reasoning loop fires:
   - Confirms 3pm Tuesday
   - calls send_completing("Meeting confirmed: 3pm Tuesday")
   - task.status = "completing" on AgentB side

7. AgentA receives { type: "completing", content: "3pm Tuesday confirmed" }:
   - Does final processing
   - task.status = "closing" on AgentA side
   - sends { type: "completed" }
   - task.status = "closed" on AgentA side
   - fires callbackSessionKey: dispatchAgentHook(sessionKey: "whatsapp:acct:dm:personA")
   - AgentA generates: "I've got you booked for 3pm Tuesday with B"
   - delivered to PersonA on WhatsApp

8. AgentB receives { type: "completed" }:
   - task.status = "closed" on AgentB side
   - AgentB notifies PersonB via primary channel (Telegram):
     "A reached out and I've booked 3pm Tuesday with A. Let me know if you want to change it."
```

---

## Security Model

### Trust Tiers

| Tier                | Who                                             | Trust level                                  |
| ------------------- | ----------------------------------------------- | -------------------------------------------- |
| Principal           | The human owner of the agent                    | Full trust — sets rules, receives all info   |
| Verified peer agent | Remote agent with valid Ed25519 sig + allowlist | Task-scoped trust — within negotiation scope |
| Unverified inbound  | Request without valid signature                 | Rejected at gateway                          |

### Properties

- **No implicit tool execution**: Remote agents cannot trigger tool calls on the local agent directly. The local agent's reasoning loop decides which tools to invoke based on the message content.
- **Allowlist-gated**: No inbound A2A message reaches an agent without the remote peer being on the local allowlist.
- **Signature required**: Every message is signed. Invalid signatures are rejected before reaching any agent logic.
- **Replay prevention**: The `X-A2A-Timestamp` header is validated within a ±30-second window. Messages outside this window are rejected.
- **HumanGate rate limit**: An agent cannot open more than N human gates per task (configurable) to prevent a malicious peer from spamming the principal.
- **Scope isolation**: A2A sessions run under a restricted tool policy — the agent cannot take actions outside the negotiation scope (e.g., cannot read files, run shell commands) unless the principal has explicitly configured that.

---

## File Layout

```
src/a2a/
  address.ts               AgentAddress type, DID parsing, public key resolution
  task-store.ts            Persist/load/update A2ATask records (JSON, per-agent dir)
  task-state.ts            State machine transitions and validation
  message-queue.ts         Outbox queue with retry (wraps src/infra/retry.ts)
  gate.ts                  HumanGate create/answer/notify
  gateway-handler.ts       POST /a2a/message HTTP endpoint handler
  gateway-wellknown.ts     GET /.well-known/openclaw.json handler
  resume.ts                Wake agent after gate answered (wraps CronService.wake)
  discovery.ts             DNS SRV + registry client for peer discovery
  signing.ts               Ed25519 sign/verify helpers for A2A headers
  session-keys.ts          a2a:<taskId> session key helpers

extensions/openclaw-peer/
  package.json             Channel plugin package
  src/
    index.ts               Plugin entry; registers channel and HTTP routes
    channel.ts             ChannelPlugin implementation
    agent-prompt.ts        sessionContext + messageToolHints for A2A mode
    agent-tools.ts         get_principal_calendar_slots, get_standing_rules, etc.
    outbound.ts            Delivery of replies back to remote gateway

src/gateway/
  server-a2a.ts            Wires A2A handler into HTTP server dispatch chain
  gateway-wellknown.ts     Wires well-known handler

src/sessions/
  session-key-utils.ts     (extend) isA2ASessionKey, parseA2ASessionKey helpers

src/channels/plugins/types.core.ts
                           (extend) ChannelAgentPromptAdapter with sessionContext
```

---

## Configuration

```yaml
federation:
  enabled: true
  publicUrl: "https://gateway.example.com" # public gateway URL for this instance
  allowedPeers:
    - did: "did:openclaw:<uuid>" # allowlisted remote agent DIDs
      label: "Bob's agent"
    - domain: "trusted-instance.example.com" # allowlisted gateway domains
  taskTtlMs: 86400000 # 24h default task TTL
  maxGatesPerTask: 5 # max human gates before task is auto-failed
  replayWindowMs: 30000 # signature replay window (±30s)
```

---

## Mapping to Existing OpenClaw Primitives

| A2A concept                           | Built on                                         |
| ------------------------------------- | ------------------------------------------------ |
| Task state persistence                | Cron job store pattern (`src/cron/store.ts`)     |
| Restart-catchup for in-progress tasks | `service.restart-catchup` pattern                |
| Pause-and-wait (HumanGate)            | `src/infra/exec-approvals.ts` pattern            |
| Wake agent after gate answered        | `CronService.wake()`                             |
| Outbox retry                          | `src/infra/retry.ts`                             |
| Session key routing                   | `src/routing/session-key.ts` (new `a2a:` prefix) |
| Callback delivery to human session    | `dispatchAgentHook` (hooks infrastructure)       |
| Channel-specific tools                | `ChannelPlugin.agentTools`                       |
| Channel-specific prompt context       | `ChannelPlugin.agentPrompt` (extended)           |
| Plugin HTTP route registration        | `registry.httpRoutes`                            |
| Inbound allowlist                     | `src/channels/plugins/allow-from.ts` pattern     |
