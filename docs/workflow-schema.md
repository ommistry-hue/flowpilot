# Workflow schema

A workflow is a JSON document with camelCase keys. You can write it by hand, export it from the designer, generate it with AI, or keep it in Git. The authoritative definition is [SPEC.md §1](SPEC.md#1-workflow-definition-json-camelcase); the C# types are in `src/FlowPilot.Abstractions/WorkflowDefinition.cs`.

## Top level

| Field | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | string | yes | Currently `"1"` |
| `id` | GUID | no on create | Assigned by the server if omitted |
| `name` | string | yes | |
| `description` | string | no | |
| `variables` | object | no | Initial run variables, available as `vars` |
| `nodes` | `Node[]` | yes | |
| `edges` | `Edge[]` | yes | |

## Node

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique within the workflow. Used in edges and in `nodes.<id>` expressions; keep it short and code-friendly |
| `type` | string | yes | Activity type, e.g. `http.request`. See the [activity list](#built-in-activity-types) |
| `name` | string | no | Display name in the designer |
| `config` | object | yes | Activity inputs. String values may contain `{{ }}` [expressions](expressions.md) |
| `retry` | `RetryPolicy` \| null | no | |
| `timeoutMs` | number \| null | no | Per-attempt timeout |
| `position` | `{ x, y }` | no | Designer only; ignored by the engine |

## RetryPolicy

| Field | Default |
|---|---|
| `maxAttempts` | `3` |
| `initialDelayMs` | `1000` |
| `backoffMultiplier` | `2` |
| `maxDelayMs` | `60000` |

Delay before attempt *n + 1* is `min(initialDelayMs × backoffMultiplier^(n−1), maxDelayMs)`.

## Edge

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique within the workflow |
| `source` | string | Source node ID |
| `sourceHandle` | string | The outcome that follows this edge. Default `done` |
| `target` | string | Target node ID |

Common outcomes: `done`, `true`, `false`, `item`, `approved`, `rejected`, `error`. `switch` uses its case names plus `default`.

## Semantics in brief

- A run starts at one trigger node (`trigger.*`).
- Outcome `X` sends a token down every edge with `sourceHandle == X`. Two edges on one outcome means two parallel branches.
- A node's `input` is the output of the node whose edge produced the token.
- A node with no matching outgoing edge ends its branch. The run completes when nothing is left to do.
- When retries are exhausted, a failed node follows its `error` edges; with none, the run fails.
- Loops are explicit cycles back to a `loop.forEach` node.
- `flow.join` waits for all incoming edges (`mode: all`) or the first (`mode: any`).

## Built-in activity types

| type | outcomes | config |
|---|---|---|
| `trigger.manual` | done | `inputSchema?` |
| `trigger.webhook` | done | `path`, `method` (GET/POST/PUT/ANY) |
| `trigger.cron` | done | `cron`, `timezone?` |
| `trigger.event` | done | `event` |
| `condition` | true, false | `expression` |
| `switch` | case names + `default` | `cases: [{ name, expression }]` |
| `loop.forEach` | item, done | `items` |
| `flow.parallel` | done | — |
| `flow.join` | done | `mode` (`all` / `any`) |
| `delay` | done | `durationMs` or `until` (ISO 8601) |
| `approval` | approved, rejected | `title`, `description`, `assignee?` |
| `variable.set` | done | `name`, `value` |
| `http.request` | done | `url`, `method`, `headers` (JSON), `body`, `timeoutMs?` |
| `script` | done | `code` |
| `log` | done | `message`, `level` |
| `ai.prompt` | done | `prompt`, `system?`, `model?`, `json` (bool) |
| `wait.event` | done | `event`, `correlationKey` |

Outputs and notes for each are in [SPEC.md §2](SPEC.md#2-built-in-activities). Plugins add more; `GET /api/activities` lists everything installed, with input metadata.

## Minimal example

```json
{
  "schemaVersion": "1",
  "name": "Hello",
  "nodes": [
    { "id": "start", "type": "trigger.manual", "config": {} },
    { "id": "say", "type": "log", "config": { "message": "Hello {{ input.name ?? 'world' }}" } }
  ],
  "edges": [
    { "id": "e1", "source": "start", "sourceHandle": "done", "target": "say" }
  ]
}
```

Create and run it:

```bash
curl -X POST http://localhost:5080/api/workflows -H "Content-Type: application/json" -d @hello.json
curl -X POST http://localhost:5080/api/workflows/<id>/run -H "Content-Type: application/json" -d '{"input":{"name":"Ada"}}'
```

## Validation

`POST /api/workflows/validate` returns `{ valid, errors: [{ nodeId?, edgeId?, message }] }`. The designer and the AI generator both use it.

More complete workflows are in [`examples/`](../examples/).
