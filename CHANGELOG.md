# Changelog

All notable changes to FlowPilot are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, minor versions may contain breaking changes; they are called out under **Changed**.

## [Unreleased]

## [0.1.0] - 2026-10-27

First public release.

### Added

- **Visual designer** (React) with drafts, publishing and immutable workflow versions.
- **Durable execution engine** on EF Core with SQLite (default) or PostgreSQL. Every node execution is checkpointed; work items are leased and delivered at least once.
- **Retries** with exponential backoff per node, `error` edges, run cancel and run retry.
- **Token-based graph semantics**: parallel branches, explicit loops, `flow.join` with `all`/`any`.
- **Built-in activities**: `trigger.manual`, `trigger.webhook`, `trigger.cron`, `trigger.event`, `condition`, `switch`, `loop.forEach`, `flow.parallel`, `flow.join`, `delay`, `approval`, `variable.set`, `http.request`, `script`, `log`, `ai.prompt`, `wait.event`.
- **Suspension with bookmarks** for approvals, delays and external events; approvals inbox in the UI.
- **JavaScript expressions** with Jint (`{{ }}` templates and expression inputs), sandboxed to 2 s, 4 MB and 100k statements.
- **AI workflow generation** from a prompt (`POST /api/ai/generate`), validated and auto-laid-out, with Anthropic or OpenAI-compatible providers.
- **Live run view** over SignalR (`/hubs/runs`).
- **REST API** for workflows, runs, approvals, events and stats; webhooks at `/hooks/{path}`; `/health`.
- **API-key auth** via `FlowPilot:ApiKey` (`X-Api-Key` or `Bearer`). Docker Compose requires `FLOWPILOT_API_KEY`, and the server warns at startup when no key is set outside Development.
- **Secrets**: `FLOWPILOT_SECRET_<NAME>` environment variables are available as `{{ secrets.NAME }}` and masked as `***` in run history, variables and logs.
- **Webhook authentication**: a per-trigger shared secret, checked against `X-FlowPilot-Secret` or a GitHub-style `X-Hub-Signature-256` HMAC in constant time.
- **Safety limits**:
  - `FlowPilot:Engine:MaxStepsPerRun`
  - `FlowPilot:Http:MaxResponseBytes`
  - `FlowPilot:Webhooks:MaxBodyBytes`
  - `FlowPilot:Http:BlockPrivateNetworks`, on by default in the Docker image
  - retention of finished runs, `FlowPilot:Retention:Days`
- **Configurable worker pool** (`FlowPilot:Engine:Workers`), lease renewal for long-running activities, and an immediate abort of running activities when a run is cancelled.
- **Run validation**: drafts are validated before a run starts.
- **Plugin SDK** (`FlowPilot.Abstractions`) with per-plugin `AssemblyLoadContext` loading, and `AddFlowPilot().AddActivity<T>()` for embedding.
- **Docker image** (non-root, port 5080, `/data` volume) and Docker Compose setup with PostgreSQL 17.
- **CI**:
  - .NET tests against SQLite and PostgreSQL 17
  - web lint and build
  - a Docker build on every pull request

[Unreleased]: https://github.com/ommistry-hue/flowpilot/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ommistry-hue/flowpilot/releases/tag/v0.1.0
