# Launch checklist

The goal is GitHub trending: first the C# language page, then the overall daily page. Trending ranks stars per unit of time relative to a repo's usual pace, so the launch concentrates attention into one 24-hour window.

Replace every `OWNER` before launch.

## 1. Repository settings

### Description (About box)

> Open-source n8n alternative for .NET. Visual workflow designer, durable execution on SQLite or PostgreSQL, approvals, webhooks, cron and AI workflow generation. Self-hosted, Apache-2.0, embeddable in ASP.NET Core.

Website field: the docs or the hosted demo once it exists. Tick **Releases** and **Packages**; untick **Wiki** and **Projects** unless they are used.

### Topics (20)

```
workflow-automation  workflow-engine  n8n-alternative  zapier-alternative
dotnet  csharp  aspnet-core  self-hosted  low-code  no-code
durable-execution  automation  orchestration  webhooks  human-in-the-loop
llm  ai  react  visual-programming  ipaas
```

### Social preview

- 1280 × 640 px PNG (minimum 640 × 320), under 1 MB. Upload at **Settings → General → Social preview**.
- Left third: logo and "FlowPilot". Under it, the tagline "Open-source n8n alternative for .NET".
- Right two thirds: a cropped designer screenshot with a run in progress (green and running nodes visible).
- Keep 40 px of safe margin; X/Twitter and Slack crop the edges. Text at least 48 px so it reads in a feed thumbnail.
- Dark background (it stands out in light-mode feeds) with the logo gradient as accent.

### Before going public

- [ ] README renders: badges green, screenshots present, `demo.gif` recorded (≤ 8 MB, 15–20 s: prompt → generated workflow → run with live status).
- [ ] `docker compose up` and the `docker run` one-liner work on a clean machine. `ghcr.io/ommistry-hue/flowpilot:latest` is public (Packages → visibility).
- [ ] `v0.1.0` tag pushed, GitHub Release written with the GIF and the CHANGELOG entry.
- [ ] Discussions enabled with categories Q&A, Ideas, Show and tell. A pinned welcome post.
- [ ] 20 good-first-issues seeded (section 6) and labelled `good first issue` + `help wanted`.
- [ ] Contact placeholders filled in `CODE_OF_CONDUCT.md`, `SECURITY.md`, README Discord link.
- [ ] Private vulnerability reporting enabled (Settings → Security).
- [ ] Every example in `examples/` imports and runs.

## 2. Timing plan

| When | What |
|---|---|
| T−7 to T−2 days | Fix rough edges found by 3–5 friendly testers. Write all posts below. |
| T−2 to T−1 days | **Soft launch** for the first **50–150 stars**: personal network, colleagues, .NET Discord/Slack communities, LinkedIn and X/Bluesky posts. A repo that already has stars and a few issues converts HN and Reddit visitors better. |
| Launch day, **Tue–Thu, 8–9 am ET** | Post Show HN. Stay at the keyboard for 6 hours and answer every comment. |
| +2 to +3 h | r/dotnet post. |
| +4 to +6 h | r/selfhosted post (it skews to evenings and weekends in the US and EU, so this can slide to the next morning). |
| Launch day | X/Bluesky/Mastodon/LinkedIn thread with the GIF. Ask friends to share, not to upvote: vote rings get posts killed. |
| +1 to +7 days | Ship a fast `v0.1.1` with fixes from launch feedback. Thank contributors publicly. |

Targets: about **300–700 stars in 24 hours** reaches the overall daily trending page; the C# trending page needs far fewer. Trending then feeds itself for 2–4 days.

## 3. Show HN

**Title** (80 characters max):

> Show HN: FlowPilot – open-source n8n alternative for .NET with durable execution

**URL:** `https://github.com/ommistry-hue/flowpilot`

**First comment** (post it right after submitting):

> Hi HN, I built FlowPilot because every visual workflow tool I tried was either Node.js-only, fair-code licensed, or both, and the .NET options were libraries without a designer that non-developers could use.
>
> FlowPilot is a single .NET 10 process with a React designer. A few things that might be interesting:
>
> - **Durable by default.** Every node execution is a row in SQLite or Postgres and doubles as the checkpoint. Workers claim work items with leases (`FOR UPDATE SKIP LOCKED` on Postgres, `UPDATE ... RETURNING` on SQLite), so a crash re-runs the step instead of losing the run. Approvals, delays and event waits are bookmarks, so a run can wait a week without holding a thread.
> - **Token-based graph.** Parallel branches are just several edges on one outcome; loops are explicit cycles; a join node waits for all or any incoming edges.
> - **AI generation.** Describe a workflow and the server prompts Anthropic or any OpenAI-compatible model with the live activity catalogue, validates the JSON, retries once with the errors, and lays it out.
> - **Plugins are one C# class.** `[Activity]` and `[Input]` attributes drive the designer form. Each plugin DLL gets its own AssemblyLoadContext.
> - **Embeddable.** `services.AddFlowPilot()` puts the engine inside an existing ASP.NET Core app.
>
> It is Apache-2.0, and RBAC/SSO will stay free when they land. It is v0.1: the integration catalogue is small (HTTP covers a lot), and multi-node scaling is on the roadmap.
>
> `docker run -p 5080:5080 ghcr.io/ommistry-hue/flowpilot` gets you running. I'd love feedback on the execution model and on which integrations to build first.

Answer questions about Temporal, Elsa and n8n factually and generously. Link the comparison table rather than arguing.

## 4. Reddit drafts

Read each subreddit's self-promotion rules on the day. Post as yourself, reply to every comment, and do not cross-post the same text.

### r/dotnet

**Title:** I built an open-source, self-hosted n8n alternative in .NET 10 (visual designer, durable workflows, plugin SDK)

> FlowPilot is a visual workflow automation platform written in C# and ASP.NET Core, Apache-2.0.
>
> The parts .NET folks may care about:
>
> - Custom nodes are one class: implement `IActivity`, add `[Activity("slack.message")]` and `[Input]` properties, and the React designer builds the config form from metadata.
> - Plugins load from `plugins/<Name>/` into their own `AssemblyLoadContext` with `AssemblyDependencyResolver`, so dependency versions don't collide.
> - Durable execution on EF Core (SQLite or Postgres): node executions are checkpoints, work items are leased, approvals and delays suspend via bookmarks.
> - Jint for sandboxed JS expressions, SignalR for live run updates, Cronos for cron.
> - `builder.Services.AddFlowPilot().AddActivity<MyActivity>()` to embed it in your own app.
>
> Repo: https://github.com/ommistry-hue/flowpilot
>
> I'd especially like feedback on the plugin API before it hits 1.0, and on how you'd want it packaged on NuGet.

### r/selfhosted

**Title:** FlowPilot: a self-hosted workflow automation tool (n8n-style), Apache-2.0, runs in one container with SQLite

> I've been building FlowPilot, a visual workflow automation tool you can self-host.
>
> - `docker run -p 5080:5080 -v flowpilot-data:/data ghcr.io/ommistry-hue/flowpilot`, or Docker Compose with Postgres 17
> - Webhook, cron, manual and event triggers; conditions, switches, loops, parallel branches
> - Human approvals and long delays that survive restarts
> - Optional AI: describe a workflow and it drafts the graph (Anthropic, or OpenAI-compatible APIs including a local Ollama)
> - Small: one .NET process, about the footprint of a typical ASP.NET app, non-root image
> - Apache-2.0, no "enterprise edition" for basics; SSO/RBAC are planned and will stay free
>
> Screenshots and setup: https://github.com/ommistry-hue/flowpilot
>
> It's early (v0.1). What integrations would make it useful in your homelab?

## 5. Launch-day monitoring

- Watch Issues and Discussions every 30 minutes. Label and answer first-time issues fast; a responsive maintainer is the strongest signal to new visitors.
- Keep a running list of feedback. Turn repeated requests into issues tagged `launch-feedback`.
- Do not edit the HN title after posting. Do not ask for upvotes.

## 6. Growth playbook

Stars come from launches; forks and contributors come from easy, well-scoped work. Keep a steady stream of both.

### Seed 20 good first issues

Each issue states the type name, the inputs, the expected output, links to the service's API docs and to `docs/writing-activities.md`, and says "one class plus one test".

1. Add `slack.message` activity (incoming webhook)
2. Add `discord.message` activity (webhook)
3. Add `email.send` activity (SMTP)
4. Add `teams.message` activity (Microsoft Teams workflow webhook)
5. Add `telegram.message` activity (Bot API `sendMessage`)
6. Add `postgres.query` activity (parameterised query, rows as JSON)
7. Add `sqlserver.query` activity
8. Add `openai.embeddings` activity (OpenAI-compatible `/embeddings`)
9. Add `googlesheets.appendRow` activity
10. Add `s3.putObject` activity (AWS S3 and MinIO)
11. Add `azureblob.upload` activity
12. Add `github.issue.create` activity
13. Add `rss.read` activity (feed items as an array for `loop.forEach`)
14. Add `csv.parse` activity
15. Add `crypto.hmacVerify` activity for webhook signature checks (GitHub, Stripe)
16. Add `datetime.format` activity with time zones
17. Example: Stripe webhook → verify signature → email receipt (`examples/`)
18. Example: RSS feed → `ai.prompt` summary → Discord, daily (`examples/`)
19. Designer: show a node's last output as a tooltip in the run view
20. Docs: deploy FlowPilot behind Caddy with automatic HTTPS

Keep about 10 open at all times. When one closes, open another.

### Awesome-list PRs

Open one PR per list in the week after launch. Follow each list's format and contribution rules exactly; some require a minimum project age or star count.

| List | Section |
|---|---|
| [quozd/awesome-dotnet](https://github.com/quozd/awesome-dotnet) | Workflow |
| [thangchung/awesome-dotnet-core](https://github.com/thangchung/awesome-dotnet-core) | Workflow |
| [awesome-selfhosted/awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted-data) | Automation (requires the first release to be over 4 months old) |
| [meirwah/awesome-workflow-engines](https://github.com/meirwah/awesome-workflow-engines) | Full fledged product |
| [stn1slv/awesome-integration](https://github.com/stn1slv/awesome-integration) | Workflow engines / iPaaS |
| [ElijT/awesome-no-code-tools](https://github.com/ElijT/awesome-no-code-tools) | Automation |

Also pitch .NET and self-hosting newsletters: The Morning Brew, .NET Weekly, C# Digest, selfh.st weekly.

### Release cadence

- **Weekly release**, every Tuesday, even if small: `v0.x.y` tag → `docker.yml` publishes to GHCR → GitHub Release with notes. Each release puts the repo back in watchers' feeds.
- **CHANGELOG.md** in Keep a Changelog format. Every PR adds a line under `[Unreleased]`; the release moves it under the new version.
- Release notes lead with a GIF or screenshot of the most visible change and thank each contributor by handle.
- A minor version (`v0.2.0`) every 4–6 weeks with a roadmap item (migrations, secrets vault, sub-workflows).

### Social posting cadence

| Cadence | Channel | Content |
|---|---|---|
| Launch week, daily | X, Bluesky, Mastodon, LinkedIn | One feature per day with a short clip: approvals, AI generation, plugin in 10 lines, live run view, Docker one-liner |
| Weekly (release day) | Same | What shipped, with a GIF; tag new contributors |
| Every 2 weeks | Blog / dev.to / Hashnode | A deep dive: how the work-item lease works, writing a plugin, durable approvals |
| Monthly | r/dotnet or r/selfhosted (alternate; never both in one week) | Only for notable releases, framed as "what changed and why" |
| Milestones (1k, 5k stars) | All | A thank-you post with the star-history chart |
