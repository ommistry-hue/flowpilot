# Roadmap

This is a direction, not a promise of dates. Items move based on feedback, so vote with a 👍 on the linked issues or start a [Discussion](https://github.com/ommistry-hue/flowpilot/discussions).

**Shipped in v0.1:** visual designer, durable execution on SQLite/PostgreSQL, retries and error edges, approvals, delays, event waits, cron/webhook/event triggers, JavaScript expressions, `ai.prompt`, prompt-to-workflow generation, live run view, plugin SDK, embeddable engine, Docker image. See [docs/SPEC.md](docs/SPEC.md).

## Our licensing promise

FlowPilot stays Apache-2.0. **RBAC, SSO and audit features will be free and OSI-licensed, forever.** No "enterprise edition" for security basics. If we ever offer paid services, they will be hosting and support, not features held back from self-hosters.

## Next (v0.2)

- **EF Core migrations.** Replace `EnsureCreated` with versioned migrations for SQLite and PostgreSQL, so upgrades preserve data.
- **Secrets vault.** Encrypted credentials referenced from config (`{{ secrets.slackWebhook }}`), never stored in workflow JSON or run history.
- **Sub-workflows.** Call a published workflow as a node, wait for its result, and reuse logic across workflows.
- **More integrations.** Slack, Discord, Microsoft Teams, email (SMTP), GitHub, Google Sheets, Postgres/SQL Server query, S3/Blob storage, OpenAI-compatible embeddings.
- **OpenTelemetry tracing.** One trace per run, one span per node execution, exported over OTLP.

## Later (v0.3+)

- **RBAC and SSO.** Users, roles and workflow-level permissions. OIDC (Entra ID, Google, Keycloak, Authentik). Free, as promised above.
- **MCP / agent tool-calling node.** An agent node that lets an LLM call other activities and MCP servers as tools, with step limits and a full transcript in the run history.
- **Git sync.** Store workflow definitions in a Git repo. Push on publish, pull on deploy, review changes in PRs.
- **Multi-node scaling.** Run several server instances against one PostgreSQL database. Work-item claiming already uses `FOR UPDATE SKIP LOCKED`; `LISTEN/NOTIFY` will wake idle workers across nodes and fan SignalR updates out to all instances.
- **NuGet packages.** Publish `FlowPilot.Abstractions` and `FlowPilot.Core` so plugins and embedding hosts can take a package reference.
- **Hosted demo.** A public, resettable sandbox to try the designer without installing anything.

## Ideas we are considering

- Workflow templates gallery
- Run-history retention policies and pruning
- Per-node rate limiting and concurrency limits
- A CLI to import, export, run and tail workflows

Have something that is not here? Open a [feature request](https://github.com/ommistry-hue/flowpilot/issues/new?template=feature_request.yml).
