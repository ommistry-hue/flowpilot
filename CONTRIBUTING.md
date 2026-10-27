# Contributing to FlowPilot

Thanks for helping. Bug reports, new activities, docs fixes and design feedback are all welcome.

## Ground rules

- Be kind. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- For anything bigger than a bug fix, open an issue or a [Discussion](https://github.com/ommistry-hue/flowpilot/discussions) first, so we agree on the approach before you write code.
- [`docs/SPEC.md`](docs/SPEC.md) is the contract between the engine, the API and the designer. A change to the workflow schema, the API or engine semantics updates the spec in the same PR.
- Report security issues privately. See [SECURITY.md](SECURITY.md).

## Repository layout

| Path | What lives there |
|---|---|
| `src/FlowPilot.Abstractions` | Plugin SDK: `IActivity`, attributes, `ActivityResult`, workflow model |
| `src/FlowPilot.Core` | Engine, persistence, worker, expressions, built-in activities, `AddFlowPilot()` |
| `src/FlowPilot.Server` | ASP.NET Core host: REST API, webhooks, SignalR, serves the UI |
| `tests/FlowPilot.Tests` | Unit and integration tests |
| `samples/FlowPilot.Plugins.Sample` | Example plugin |
| `web/` | React designer (Vite); builds into `src/FlowPilot.Server/wwwroot` |
| `examples/` | Importable workflow JSON files |
| `docs/` | Spec, architecture and guides |

## Development setup

Prerequisites: .NET SDK 10, Node 24, Git. Docker is optional.

```bash
git clone https://github.com/ommistry-hue/flowpilot.git
cd flowpilot

# backend on http://localhost:5080
dotnet run --project src/FlowPilot.Server

# designer on http://localhost:5173 (proxies /api, /hooks, /hubs, /health to :5080)
cd web
npm i
npm run dev
```

Run the checks CI runs before you push:

```bash
dotnet build FlowPilot.slnx
dotnet test FlowPilot.slnx

cd web
npm ci
npm run lint
npm run build
```

To try PostgreSQL locally, run `docker compose up postgres -d` and set `FlowPilot__Database__Provider=postgres` plus `ConnectionStrings__FlowPilot`.

## Pull requests

1. Fork the repo and branch from `main`.
2. Keep each PR focused on one change. Small PRs get reviewed faster.
3. Add or update tests. Engine changes need a test that drives a workflow end to end.
4. Update docs when behaviour changes: `docs/SPEC.md`, `README.md` or the guides.
5. Fill in the PR template and link the issue.

Commit messages: short imperative subject (`Add retry jitter to http.request`). Conventional Commit prefixes (`feat:`, `fix:`, `docs:`) are welcome but not required.

## Code style

- `.editorconfig` is the source of truth. Run `dotnet format` before pushing.
- C#: file-scoped namespaces, nullable enabled, `async` all the way, pass the `CancellationToken` through.
- TypeScript: strict mode, function components, `npm run lint` clean.
- Prefer clear code over comments. Comment the *why*.

## Contributing an activity

New integrations are the easiest way to contribute. Read [docs/writing-activities.md](docs/writing-activities.md), then:

- Use a dotted, lowercase type name grouped by service: `slack.message`, `github.issue.create`.
- Give every `[Input]` a `DisplayName` and `Description`; they show up in the designer.
- Return `ActivityResult.Fail(...)` for errors the user can fix. Throw only for bugs.
- Add a test, and an example workflow in `examples/` if it helps.

Not sure if an integration belongs in core or in a plugin? Open a [new activity issue](https://github.com/ommistry-hue/flowpilot/issues/new?template=new_activity.yml).

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
