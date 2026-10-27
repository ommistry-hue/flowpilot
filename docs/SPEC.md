# FlowPilot Technical Specification (v0.1)

This is the contract between the engine, the HTTP API and the designer. Change it deliberately.

## 1. Workflow definition (JSON, camelCase)

```json
{
  "schemaVersion": "1",
  "id": "8d2f...uuid",
  "name": "New order -> Slack",
  "description": "optional",
  "variables": { "count": 0 },
  "nodes": [
    { "id": "trigger1", "type": "trigger.webhook", "name": "Order webhook",
      "config": { "path": "orders", "method": "POST" }, "position": { "x": 0, "y": 0 } },
    { "id": "check", "type": "condition", "config": { "expression": "input.body.total > 100" },
      "retry": null, "timeoutMs": null, "position": { "x": 250, "y": 0 } },
    { "id": "notify", "type": "http.request",
      "config": { "url": "https://hooks.example.com/x", "method": "POST", "body": "{{ ({ text: 'Big order ' + input.body.id }) }}" },
      "retry": { "maxAttempts": 3, "initialDelayMs": 1000, "backoffMultiplier": 2, "maxDelayMs": 60000 },
      "position": { "x": 500, "y": 0 } }
  ],
  "edges": [
    { "id": "e1", "source": "trigger1", "sourceHandle": "done", "target": "check" },
    { "id": "e2", "source": "check", "sourceHandle": "true", "target": "notify" }
  ]
}
```

C# types live in `src/FlowPilot.Abstractions/WorkflowDefinition.cs`. `position` is for the designer only.

### Graph semantics (token-based)
- A run starts at one **trigger node** (`trigger.*`). Its output is the trigger payload.
- When a node completes with outcome `X`, every edge with `sourceHandle == X` from that node creates a token for its target. Several edges on one outcome means **parallel branches**.
- A node's `input` is the output of the node whose edge produced the token.
- A node with no matching outgoing edges ends that branch. The run **completes** when no tokens, work items or bookmarks remain.
- **Errors:** after the retries are exhausted, a failed node follows its `error` edges if it has any. Otherwise the run fails.
- **Loops are explicit cycles.** `loop.forEach` emits `item` once per element. The last node of the body must connect back to the forEach node. When the items are exhausted, forEach emits `done`. Loop progress lives in the node's `NodeState`.
- **Join:** `flow.join` waits until a token has arrived from each distinct incoming edge (`mode: all`), or fires on the first (`mode: any`, later tokens are dropped). Its output is `{ "<sourceNodeId>": output, ... }`.

### Expressions
- Any string config value containing `{{ ... }}` is evaluated with Jint before the activity runs.
- A value that is a single `{{ expr }}` keeps the JS result type. Mixed text interpolates to a string.
- `InputKind.Expression` inputs, such as `condition.expression`, are raw JS without braces.
- Scope:
  - `input`: the incoming output
  - `vars`: the run variables
  - `nodes`: `nodes.<id>.output`
  - `trigger`: the trigger payload
  - `run`: `{ id, workflowId }`
  - `item` and `index`: set inside a forEach body, taken from the nearest forEach state
- Sandbox: 2s timeout, 4MB memory, 100k statements, no CLR access.

## 2. Built-in activities

| type | outcomes | config | notes |
|---|---|---|---|
| `trigger.manual` | done | `inputSchema?` | started via the API or UI |
| `trigger.webhook` | done | `path`, `method` (GET/POST/PUT/ANY) | `/hooks/{path}`. Output `{ method, headers, query, body }` |
| `trigger.cron` | done | `cron` (Cronos, with seconds optional), `timezone?` | published workflows only. Output `{ firedAt }` |
| `trigger.event` | done | `event` | `POST /api/events/{event}`. Output is the payload |
| `condition` | true, false | `expression` | |
| `switch` | dynamic: case names + `default` | `cases: [{ name, expression }]` | first match wins |
| `loop.forEach` | item, done | `items` (expression) | output per item `{ item, index }` |
| `flow.parallel` | done | - | pass-through. Fan out by drawing several edges |
| `flow.join` | done | `mode` all/any | |
| `delay` | done | `durationMs` or `until` (ISO) | suspends using a Delay bookmark |
| `approval` | approved, rejected | `title`, `description`, `assignee?` | suspends using an Approval bookmark |
| `variable.set` | done | `name`, `value` | |
| `http.request` | done | `url`, `method`, `headers` (json), `body`, `timeoutMs?` | output `{ status, headers, body }`. Non-2xx = Fail |
| `script` | done | `code` (JS, `return` value) | Jint sandbox |
| `log` | done | `message`, `level` | appears in node output |
| `ai.prompt` | done | `prompt`, `system?`, `model?`, `json` (bool) | LLM call through the configured provider. Output `{ text, json? }` |
| `wait.event` | done | `event`, `correlationKey` | suspends using an Event bookmark |

## 3. Durable execution

Tables, via EF Core with SQLite as the default and PostgreSQL as an option:

- `WorkflowDefinitions(Id, Name, Description, DraftJson, PublishedVersion?, CreatedAt, UpdatedAt)`
- `WorkflowVersions(Id, DefinitionId, Version, Json, CreatedAt)`: published, immutable.
- `WorkflowRuns(Id, DefinitionId, Version?, DefinitionSnapshotJson, Status, TriggerNodeId, InputJson, VariablesJson, NodeStateJson, OutputsJson, Error, CreatedAt, StartedAt, CompletedAt, ConcurrencyToken)`
  - `Status`: Pending | Running | Suspended | Completed | Failed | Cancelled.
- `NodeExecutions(Id, RunId, NodeId, NodeType, Attempt, Status, InputJson, OutputJson, Outcome, Error, StartedAt, CompletedAt)`: this table is both the history and the checkpoint.
- `WorkItems(Id, RunId, NodeId, InputJson, ResumePayloadJson, Attempt, AvailableAt, LockedBy, LockedUntil, CreatedAt)`: the queue.
- `Bookmarks(Id, RunId, NodeId, Kind, CorrelationKey, PayloadJson, ResumeAt, CreatedAt, ResolvedAt, ResolutionJson)`
- `ScheduleStates(DefinitionId, NodeId, NextFireAt)`

**Worker:** a `BackgroundService` polls every 500ms, and is woken immediately in-process by a channel signal.
1. It claims items atomically: `AvailableAt <= now` and (`LockedUntil` is null or `LockedUntil < now`). It sets `LockedBy` and `LockedUntil = now + 5min`. Postgres uses `FOR UPDATE SKIP LOCKED`; SQLite uses an atomic `UPDATE ... RETURNING`.
2. It executes the activity.
3. In one transaction it:
   - writes the `NodeExecution`
   - merges the variable and node-state changes into the run (optimistic concurrency, retried)
   - enqueues the successor work items, or creates a bookmark
   - deletes the claimed item
   - updates the run status
4. A crash before commit leaves the lease to expire, and the item is re-run. Delivery is at-least-once.

**Retry:** on Fail with `Attempt < MaxAttempts`, re-enqueue with `AvailableAt = now + min(initial * mult^(attempt-1), max)`.

**Resume:** resolving a bookmark enqueues a WorkItem for the same node with `ResumePayloadJson` set. The activity sees `context.ResumePayload`.

**Delay:** the bookmark worker resumes Delay bookmarks whose `ResumeAt <= now`. Delay bookmarks can also be implemented directly as a work item whose `AvailableAt` is in the future; `delay` must still show as Suspended in the UI.

**Cancel:** sets the status to Cancelled, deletes the work items and resolves the bookmarks.

**Retry run:** for a Failed run, re-enqueues the last failed node with its original input and sets the status to Running.

## 4. HTTP API (JSON camelCase, enums as strings)

```
GET    /api/activities                  -> ActivityDescriptor[]
GET    /api/workflows                   -> WorkflowSummary[]
POST   /api/workflows                   body: WorkflowDefinition (id optional) -> WorkflowDetail
GET    /api/workflows/{id}              -> WorkflowDetail
PUT    /api/workflows/{id}              body: WorkflowDefinition -> WorkflowDetail   (saves draft)
DELETE /api/workflows/{id}
POST   /api/workflows/{id}/publish      -> { version }
GET    /api/workflows/{id}/versions     -> [{ version, createdAt }]
POST   /api/workflows/{id}/run          body: { input?: any, triggerNodeId?: string } -> { runId }  (runs current draft)
POST   /api/workflows/validate          body: WorkflowDefinition -> { valid, errors: [{ nodeId?, edgeId?, message }] }
POST   /api/ai/generate                 body: { prompt, current?: WorkflowDefinition } -> { definition, explanation }
GET    /api/ai/status                   -> { enabled, provider, model }
GET    /api/runs?workflowId=&status=&skip=&take= -> { items: RunSummary[], total }
GET    /api/runs/{id}                   -> RunDetail
POST   /api/runs/{id}/cancel
POST   /api/runs/{id}/retry
GET    /api/approvals?status=pending|resolved -> ApprovalDto[]
POST   /api/approvals/{bookmarkId}/approve  body: { comment?, data? }
POST   /api/approvals/{bookmarkId}/reject   body: { comment? }
POST   /api/events/{name}               body: { payload?, correlationKey? } -> { startedRuns: Guid[], resumed: int }
ANY    /hooks/{**path}                  -> 202 { runIds }   (published workflows only; 404 if no match)
GET    /api/stats                       -> { workflows, runs24h, failed24h, pendingApprovals, runsByDay: [{ date, completed, failed }] }
GET    /health
```

DTOs:
- `ActivityDescriptor { type, displayName, category, description, icon, outcomes[], dynamicOutcomes, isTrigger, inputs: [{ name (camelCase), displayName, description, kind, options?, required, defaultValue }] }`
- `WorkflowSummary { id, name, description, publishedVersion, updatedAt, createdAt, triggerTypes[], nodeCount }`
- `WorkflowDetail { ...WorkflowSummary, definition }`
- `RunSummary { id, workflowId, workflowName, version, status, triggerNodeId, createdAt, startedAt, completedAt, durationMs, error }`
- `RunDetail { ...RunSummary, definition, input, variables, nodes: NodeExecutionDto[], bookmarks: BookmarkDto[] }`
- `NodeExecutionDto { id, nodeId, nodeType, attempt, status (Running|Completed|Failed|Suspended|Cancelled), input, output, outcome, error, startedAt, completedAt, durationMs }`
- `BookmarkDto { id, nodeId, kind, correlationKey, payload, resumeAt, createdAt, resolvedAt, resolution }`
- `ApprovalDto { id, runId, workflowId, workflowName, nodeId, title, description, assignee, createdAt, resolvedAt, resolution }`

**Auth:** if `FlowPilot:ApiKey` is set, `/api/*` and `/hubs/*` require the `X-Api-Key` header (or an `access_token` query string for SignalR). `/hooks/*` and `/health` stay open.

## 5. Real-time: SignalR hub `/hubs/runs`

- Client to server: `JoinRun(runId)`, `LeaveRun(runId)`.
- Server to client:
  - `nodeUpdated(NodeExecutionDto & { runId })`, sent to group `run:{id}`
  - `runUpdated(RunSummary)`, sent to group `run:{id}` and to all clients (used by lists)
  - `approvalsChanged()`, sent to all clients

## 6. AI generation

`FlowPilot:AI` settings:

| Setting | Values / default |
|---|---|
| `Provider` | `anthropic` or `openai` (OpenAI-compatible, e.g. Ollama or OpenRouter) |
| `ApiKey` | — |
| `Model` | default `claude-sonnet-5-5` |
| `BaseUrl` | — |

1. The server builds a system prompt from the live activity descriptors plus this schema.
2. It asks for JSON only.
3. It parses and validates the result. If validation fails, it retries once with the errors attached.
4. It auto-assigns positions with a simple left-to-right layered layout.

If the settings are not configured, `/api/ai/status` returns `enabled: false` and the UI hides or disables the feature.

## 7. Plugins

- Drop `plugins/<Name>/<Name>.dll`, together with its dependencies, into the plugins folder (`FlowPilot:PluginsPath`, default `./plugins`).
- Each plugin folder gets its own `AssemblyLoadContext` with an `AssemblyDependencyResolver`.
- `FlowPilot.Abstractions` and framework assemblies resolve from the default context.
- Every non-abstract `IActivity` with an `[Activity]` attribute is registered.
- Plugins can also be registered in code: `builder.Services.AddFlowPilot().AddActivity<MyActivity>()`.

## 8. Configuration

| Setting | Default |
|---|---|
| `FlowPilot:Database:Provider` | `sqlite` (or `postgres`) |
| `ConnectionStrings:FlowPilot` | `Data Source=flowpilot.db` |
| `FlowPilot:PluginsPath` | — |
| `FlowPilot:ApiKey` | — |
| `FlowPilot:AI:*` | — |

Server URL in dev: `http://localhost:5080`. The Vite dev server runs on `5173` and proxies `/api`, `/hooks`, `/hubs` (ws) and `/health`. In production, the server serves the built UI from `wwwroot` with an SPA fallback.

The database schema is created on startup with `EnsureCreated`. This does not alter an existing schema, so a schema change in v0.x requires recreating the database. EF Core migrations are planned before 1.0.
