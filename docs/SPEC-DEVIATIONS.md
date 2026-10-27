# Spec deviations and clarifications (backend v0.1)

Places where the implementation differs from `SPEC.md`, or fills in something the spec leaves open.

## Deviations

- **`runUpdated` is sent once to all clients.** The spec says it goes to group `run:{id}` and to all clients. Since all clients includes the group, sending to both would deliver it twice to run viewers.
- **`NodeExecutionDto` always carries `runId`.** The spec adds `runId` only to the SignalR payload. Having it in the REST DTO as well keeps one shape.
- **`NodeExecutionDto.status` adds `Cancelled`.** It applies to executions that were running or suspended when their run was cancelled or failed elsewhere.
- **`flow.join` waits in the engine, not in the activity.** Arrivals are recorded in the join's `NodeState` when an upstream node commits. The join node runs only once its condition holds, so a waiting join creates no execution rows. In `any` mode, later tokens are dropped until every incoming edge has delivered. The state then resets so the join works inside loops.
- **Resuming reuses the execution row.** A resumed approval, delay or event node updates its `Suspended` `NodeExecution` instead of adding a second row.
- **`WorkflowRuns.RetryTokensJson` (extra column).** When a run fails, it records the failed node and every branch that was dropped. See "Retry run" below.
- **`POST /api/workflows/{id}/run` validates the draft first** and returns 400 with `{ valid: false, errors }` when it is invalid.
- **`trigger.webhook` has an extra `secret` input**, and expressions have an extra `secrets` scope. Both are covered under Security below.

## Execution semantics

- **Workers.** Each process runs up to `FlowPilot:Engine:Workers` items at once (default: CPU count × 2, minimum 4).
  - The claim loop claims only as many items as there are free slots, and each item runs on the thread pool, so a slow activity never blocks claiming.
  - A commit that creates successor items wakes the loop at once through an in-process channel.
  - On SQLite, connections use `synchronous=NORMAL` in WAL mode. A 10-node linear run went from about 1.5 s to about 60 ms, because commits no longer fsync. A power loss can drop the last few commits; at-least-once execution re-runs them.
- **Leases are renewed** every `LeaseDuration / 3` (5 min lease by default) while an activity runs. Renewal fails when the item no longer exists (the run was cancelled or failed) or belongs to another worker. The activity's cancellation token is then triggered.
- **Cancelling a run** aborts its running activities at once in the same process; other processes abort them on their next renewal. Running and suspended executions are marked `Cancelled`.
- **Errors never strand a run.**
  - An activity that throws, including an `OperationCanceledException` it raised itself (such as an `HttpClient` timeout), fails the node with the exception message.
  - An engine-side error fails the node with `Internal error: …`.
  - Only the host's shutdown token hands the item back unprocessed.
- **Step limit.** A run that has executed `FlowPilot:Engine:MaxStepsPerRun` nodes (default 10,000) fails with an explanatory error. Retrying it fails again unless the limit is raised.
- **Graceful shutdown.** An item that is still running when the host stops is unlocked immediately and its partial execution row is removed, so another worker picks it up without waiting for the lease. An activity that has already finished is still committed.
- **Retry run** (`POST /api/runs/{id}/retry`, failed runs only) re-enqueues:
  1. The node that failed the run, with its original input, at attempt 1.
  2. Every work item that was pending when the run failed, as it was. This covers other branches, scheduled retries, and resume items of bookmarks that were already resolved, with their decision.
  3. Every node still waiting on an *open* bookmark. These are re-entered from the start and open a new bookmark, so a delay restarts its full duration. An approval that had been decided is not added again, so it never fires twice.

  Join progress and loop state in `NodeState` are kept, so restored branches still meet at their joins.
- **Concurrent branches** apply only the variable keys they changed to the latest run state, retried under optimistic concurrency. Different keys never lose updates. When two branches write the same key, the last commit wins.
- **Retention.** Every hour, completed, failed and cancelled runs older than `FlowPilot:Retention:Days` (default 30, `0` disables) are deleted, in batches, together with their executions and bookmarks.

## Clarifications

- **Status codes:**
  - `POST /api/workflows` returns 201.
  - `POST /api/workflows/{id}/run` returns 202 `{ runId }`, or 400 with validation errors.
  - Cancel, retry, approve and reject return 204, or 409/404 when not applicable.
  - Publishing an invalid draft returns 400 with the validation result.
  - Webhooks return 404 when no published trigger matches, 401 when a matching trigger's secret check fails, and 413 when the body is too large.
  - `POST /api/ai/generate` returns 502 when the provider fails and 504 when it times out.
  - Unknown `/api/*` routes return 404 rather than the SPA.
- **Enum strings use their C# names:** `Completed`, `Approval`, `Select`, and so on.
- **Dynamic outcomes.** Any activity with `DynamicOutcomes = true` takes its extra outcome names from a `cases` config array of `{ name }`, like `switch`. The validator and the designer both follow this convention.
- **Pass-through outputs:**
  - `condition`, `switch`, `flow.parallel` and `delay` output their input unchanged.
  - `loop.forEach` outputs `{ count, items }` on `done`.
  - `log` outputs `{ level, message }`.
  - `variable.set` outputs the value.
  - `approval` outputs the decision `{ approved, comment, data, decidedAt }`.
- **Error edges** receive `{ error, nodeId, input }`.
- **`item` and `index`** come from the nearest `loop.forEach` whose body contains the node. The body is everything reachable from the `item` edges, stopping at the forEach node itself.
- **Extra settings (all under `FlowPilot:`):**

  | Setting | Default |
  |---|---|
  | `SeedSampleWorkflows` | `true` |
  | `Engine:Workers` | CPU count × 2, minimum 4 |
  | `Engine:MaxStepsPerRun` | `10000` |
  | `AI:AnthropicVersion` | `2026-10-21` |
  | `Http:BlockPrivateNetworks` | `false` (`true` in the Docker image) |
  | `Http:MaxResponseBytes` | `10485760` |
  | `Webhooks:MaxBodyBytes` | `1048576` |
  | `Retention:Days` | `30` |
- **Anthropic API:** requests send only `model`, `max_tokens`, `system` and `messages`, with no sampling parameters, so they are valid on API version `2026-10-21`. Only `text` content blocks are read. A `refusal` stop reason is reported as an error.

## Security notes

- **Expression sandbox.** Every `{{ }}` template, `condition`/`switch` expression and `script` body runs in a fresh Jint engine:
  - no CLR access: interop is never enabled, and `System`/`importNamespace` are undefined
  - 2 s timeout, 4 MB memory, 100,000 statements, recursion depth 256, 1 s regex timeout

  Values cross the boundary as JSON only.
- **Secrets.**
  - Environment variables `FLOWPILOT_SECRET_<NAME>` are exposed as `secrets.NAME`.
  - Node config is stored unevaluated, so the definition only contains `{{ secrets.NAME }}`.
  - Exact secret values are replaced by `***` in persisted node inputs, outputs and errors, run variables, outputs and errors, bookmark payloads, `log` output and engine log lines.
  - Work items, which are transient, keep the real value so the data flow is unchanged.
  - Masking matches exact values only: a transformed secret, such as a base64-encoded one, is not detected.
- **SSRF.** `http.request` can reach any address the server can, including cloud metadata (`169.254.169.254`) and internal services. Anyone who can edit workflows can make the server send requests.
  - Set `FlowPilot:Http:BlockPrivateNetworks=true` to refuse loopback, private, link-local, CGNAT, multicast, NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) targets.
  - The check runs on the resolved IP at connect time, with system proxies disabled, so it also covers redirects and DNS rebinding.
  - Responses over `Http:MaxResponseBytes` fail the node.
- **Authentication.**
  - With `FlowPilot:ApiKey` unset, the API is open; set it for any non-local deployment. Outside Development, the server logs a warning at startup when it is missing, and Docker Compose requires `FLOWPILOT_API_KEY`.
  - Keys are compared in constant time over SHA-256 digests.
  - `/hooks/*` does not use the API key. Instead, a webhook trigger with a `secret` requires that value in `X-FlowPilot-Secret`, or an `X-Hub-Signature-256: sha256=<HMAC-SHA256 of the raw body>`, both compared in constant time.
  - A `{{ secrets.NAME }}` secret that resolves to nothing never authenticates anyone.
- **Webhook payloads.** Bodies over `Webhooks:MaxBodyBytes` get 413, enforced while streaming as well as from `Content-Length`. The `Cookie`, `Authorization`, `X-Api-Key` and `X-FlowPilot-Secret` headers are dropped before the payload is stored.
- **Errors.** Outside Development, unhandled exceptions return a generic ProblemDetails response with no stack trace. Activity error messages are stored on the run by design, with secrets masked.
