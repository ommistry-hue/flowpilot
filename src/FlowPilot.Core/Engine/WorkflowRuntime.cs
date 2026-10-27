using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core.Activities;
using FlowPilot.Core.Contracts;
using FlowPilot.Core.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FlowPilot.Core.Engine;

public sealed class WorkflowRuntimeException(string message) : Exception(message);

public sealed record PublishedWorkflow(Guid DefinitionId, int Version, WorkflowDefinition Definition);

/// <summary>Starts, resumes, cancels and retries runs. Execution itself happens in <see cref="WorkItemExecutor"/>.</summary>
public sealed class WorkflowRuntime(
    FlowPilotDbContext db,
    ActivityRegistry registry,
    WorkerSignal signal,
    IRunEventSink events,
    RunCancellations cancellations,
    SecretStore secrets,
    TimeProvider clock)
{
    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    public async Task<Guid> StartAsync(Guid definitionId, WorkflowDefinition definition, int? version, string? triggerNodeId, JsonNode? input, CancellationToken ct = default)
    {
        var trigger = ResolveTrigger(definition, triggerNodeId);
        var now = Now;
        var run = new WorkflowRunEntity
        {
            Id = Guid.NewGuid(),
            DefinitionId = definitionId,
            Version = version,
            DefinitionSnapshotJson = FlowPilotJson.Serialize(definition),
            Status = RunStatus.Pending,
            TriggerNodeId = trigger.Id,
            InputJson = FlowPilotJson.ToJson(input),
            VariablesJson = definition.Variables.ToJsonString(),
            CreatedAt = now,
            ConcurrencyToken = Guid.NewGuid(),
        };
        db.WorkflowRuns.Add(run);
        db.WorkItems.Add(new WorkItemEntity
        {
            Id = Guid.NewGuid(),
            RunId = run.Id,
            NodeId = trigger.Id,
            InputJson = run.InputJson,
            AvailableAt = now,
            CreatedAt = now,
        });
        await db.SaveChangesAsync(ct);

        signal.Notify();
        await events.RunUpdatedAsync(DtoMapper.ToSummary(run, definition.Name));
        return run.Id;
    }

    private NodeDefinition ResolveTrigger(WorkflowDefinition definition, string? triggerNodeId)
    {
        if (!string.IsNullOrEmpty(triggerNodeId))
        {
            var node = definition.Nodes.FirstOrDefault(n => n.Id == triggerNodeId)
                ?? throw new WorkflowRuntimeException($"Trigger node '{triggerNodeId}' does not exist.");
            return registry.Find(node.Type)?.Descriptor.IsTrigger == true
                ? node
                : throw new WorkflowRuntimeException($"Node '{triggerNodeId}' is not a trigger.");
        }

        var triggers = definition.Nodes.Where(n => registry.Find(n.Type)?.Descriptor.IsTrigger == true).ToList();
        return triggers.FirstOrDefault(n => n.Type == "trigger.manual")
            ?? triggers.FirstOrDefault()
            ?? throw new WorkflowRuntimeException("The workflow has no trigger node.");
    }

    /// <summary>Resolves a bookmark and schedules its node again with the resolution as resume payload.</summary>
    public async Task<bool> ResumeAsync(Guid bookmarkId, JsonNode resolution, BookmarkKind? expectedKind = null, CancellationToken ct = default)
    {
        var resumed = await db.InTransactionAsync(async () =>
        {
            var bookmark = await db.Bookmarks.FirstOrDefaultAsync(b => b.Id == bookmarkId && b.ResolvedAt == null, ct);
            if (bookmark is null || (expectedKind is not null && bookmark.Kind != expectedKind)) return null;

            var run = await db.WorkflowRuns.FirstAsync(r => r.Id == bookmark.RunId, ct);
            if (run.IsFinished) return null;

            var now = Now;
            bookmark.ResolvedAt = now;
            bookmark.ResolutionJson = FlowPilotJson.ToJson(resolution);

            var suspended = await db.NodeExecutions
                .Where(e => e.RunId == run.Id && e.NodeId == bookmark.NodeId && e.Status == NodeExecutionStatus.Suspended)
                .OrderByDescending(e => e.StartedAt)
                .FirstOrDefaultAsync(ct);

            db.WorkItems.Add(new WorkItemEntity
            {
                Id = Guid.NewGuid(),
                RunId = run.Id,
                NodeId = bookmark.NodeId,
                InputJson = suspended?.InputJson,
                ResumePayloadJson = bookmark.ResolutionJson,
                Attempt = suspended?.Attempt ?? 1,
                AvailableAt = now,
                CreatedAt = now,
            });
            run.Status = RunStatus.Running;
            run.ConcurrencyToken = Guid.NewGuid();
            return new { Run = run, bookmark.Kind };
        }, ct);

        if (resumed is null) return false;
        signal.Notify();
        await events.RunUpdatedAsync(DtoMapper.ToSummary(resumed.Run, await WorkflowNameAsync(resumed.Run, ct)));
        if (resumed.Kind == BookmarkKind.Approval) await events.ApprovalsChangedAsync();
        return true;
    }

    public async Task<int> ResumeDueDelaysAsync(CancellationToken ct = default)
    {
        var now = Now;
        var due = await db.Bookmarks.AsNoTracking()
            .Where(b => b.Kind == BookmarkKind.Delay && b.ResolvedAt == null && b.ResumeAt <= now)
            .Select(b => b.Id)
            .ToListAsync(ct);

        var resumed = 0;
        foreach (var id in due)
            if (await ResumeAsync(id, new JsonObject { ["resumedAt"] = now }, BookmarkKind.Delay, ct))
                resumed++;
        return resumed;
    }

    public async Task<bool> CancelAsync(Guid runId, CancellationToken ct = default)
    {
        var result = await db.InTransactionAsync(async () =>
        {
            var run = await db.WorkflowRuns.FirstOrDefaultAsync(r => r.Id == runId, ct);
            if (run is null || run.IsFinished) return null;

            var now = Now;
            run.Status = RunStatus.Cancelled;
            run.CompletedAt = now;
            run.StartedAt ??= now;
            run.ConcurrencyToken = Guid.NewGuid();
            await db.WorkItems.Where(w => w.RunId == runId).ExecuteDeleteAsync(ct);
            var approvalsChanged = await RunCleanup.StopOpenWorkAsync(db, runId, RunStatus.Cancelled, now, ct);
            return new { Run = run, ApprovalsChanged = approvalsChanged };
        }, ct);

        if (result is null) return false;
        cancellations.Cancel(runId);
        await events.RunUpdatedAsync(DtoMapper.ToSummary(result.Run, await WorkflowNameAsync(result.Run, ct)));
        if (result.ApprovalsChanged) await events.ApprovalsChangedAsync();
        return true;
    }

    /// <summary>
    /// Resumes a failed run: the node that failed it runs again with its original input (attempt 1), and every
    /// branch that was dropped at that moment is restored. Pending tokens are re-enqueued as they were;
    /// nodes that were suspended are re-entered and open a new bookmark (a delay restarts its full duration).
    /// </summary>
    public async Task<bool> RetryAsync(Guid runId, CancellationToken ct = default)
    {
        var run = await db.InTransactionAsync(async () =>
        {
            var run = await db.WorkflowRuns.FirstOrDefaultAsync(r => r.Id == runId, ct);
            if (run is null || run.Status != RunStatus.Failed) return null;

            var tokens = run.RetryTokensJson is { } json ? FlowPilotJson.Deserialize<List<RetryToken>>(json) : [];
            if (tokens.Count == 0)
            {
                var failed = await db.NodeExecutions
                    .Where(e => e.RunId == runId && e.Status == NodeExecutionStatus.Failed)
                    .OrderByDescending(e => e.StartedAt)
                    .FirstOrDefaultAsync(ct);
                if (failed is null) return null;
                tokens.Add(new RetryToken(failed.NodeId, failed.InputJson, null));
            }

            var now = Now;
            foreach (var token in tokens)
            {
                db.WorkItems.Add(new WorkItemEntity
                {
                    Id = Guid.NewGuid(),
                    RunId = runId,
                    NodeId = token.NodeId,
                    InputJson = token.InputJson,
                    ResumePayloadJson = token.ResumePayloadJson,
                    AvailableAt = now,
                    CreatedAt = now,
                });
            }
            run.Status = RunStatus.Running;
            run.Error = null;
            run.CompletedAt = null;
            run.RetryTokensJson = null;
            run.ConcurrencyToken = Guid.NewGuid();
            return run;
        }, ct);

        if (run is null) return false;
        signal.Notify();
        await events.RunUpdatedAsync(DtoMapper.ToSummary(run, await WorkflowNameAsync(run, ct)));
        return true;
    }

    /// <summary>Starts published workflows with a matching trigger.event and resumes matching wait.event bookmarks.</summary>
    public async Task<EventDispatchResult> PublishEventAsync(string eventName, JsonNode? payload, string? correlationKey, CancellationToken ct = default)
    {
        var started = new List<Guid>();
        foreach (var (workflow, node) in await FindPublishedTriggersAsync("trigger.event", n => ConfigText(n, "event") == eventName, ct))
            started.Add(await StartAsync(workflow.DefinitionId, workflow.Definition, workflow.Version, node.Id, payload.Clone(), ct));

        var waiting = await db.Bookmarks.AsNoTracking()
            .Where(b => b.Kind == BookmarkKind.Event && b.ResolvedAt == null)
            .ToListAsync(ct);

        var resumed = 0;
        foreach (var bookmark in waiting)
        {
            if (FlowPilotJson.AsText(FlowPilotJson.ParseObject(bookmark.PayloadJson)["event"]) != eventName) continue;
            if (bookmark.CorrelationKey is not null && bookmark.CorrelationKey != correlationKey) continue;

            var resolution = new JsonObject { ["event"] = eventName, ["correlationKey"] = correlationKey, ["payload"] = payload.Clone() };
            if (await ResumeAsync(bookmark.Id, resolution, BookmarkKind.Event, ct)) resumed++;
        }
        return new EventDispatchResult(started, resumed);
    }

    /// <summary>
    /// Starts every published workflow whose webhook trigger matches the path and method. Triggers with a
    /// <c>secret</c> only start when the request proves it knows the secret (see <see cref="WebhookAuth"/>).
    /// </summary>
    public async Task<WebhookDispatch> TriggerWebhookAsync(WebhookRequest request, CancellationToken ct = default)
    {
        var normalized = NormalizePath(request.Path);
        var matches = await FindPublishedTriggersAsync("trigger.webhook", n =>
        {
            var expected = ConfigText(n, "method");
            return NormalizePath(ConfigText(n, "path")) == normalized
                && (expected.Length == 0 || expected.Equals("ANY", StringComparison.OrdinalIgnoreCase) || expected.Equals(request.Method, StringComparison.OrdinalIgnoreCase));
        }, ct);

        var runIds = new List<Guid>();
        foreach (var (workflow, node) in matches)
        {
            if (WebhookSecret(node) is { } secret && !WebhookAuth.Verify(secret, request)) continue;
            runIds.Add(await StartAsync(workflow.DefinitionId, workflow.Definition, workflow.Version, node.Id, request.Payload.Clone(), ct));
        }
        return new WebhookDispatch(matches.Count > 0, runIds);
    }

    /// <summary>The trigger's shared secret; usually <c>{{ secrets.NAME }}</c> so the value stays out of the workflow JSON.</summary>
    private string? WebhookSecret(NodeDefinition trigger)
    {
        var configured = ConfigText(trigger, "secret");
        if (configured.Length == 0) return null;
        if (!Expressions.JintExpressionEvaluator.IsTemplate(configured)) return configured;

        var evaluator = new Expressions.JintExpressionEvaluator(new Dictionary<string, JsonNode?> { ["secrets"] = secrets.ToScope() });
        string resolved;
        try { resolved = FlowPilotJson.AsText(evaluator.EvaluateTemplate(configured)); }
        catch (Expressions.ExpressionException) { resolved = ""; }
        // A template that resolves to nothing (missing secret) must not turn into "no secret required".
        return resolved.Length > 0 ? resolved : Guid.NewGuid().ToString();
    }

    public async Task<IReadOnlyList<PublishedWorkflow>> LoadPublishedAsync(CancellationToken ct = default)
    {
        var rows = await (
            from d in db.WorkflowDefinitions.AsNoTracking()
            where d.PublishedVersion != null
            from v in db.WorkflowVersions.AsNoTracking()
            where v.DefinitionId == d.Id && v.Version == d.PublishedVersion
            select new { d.Id, v.Version, v.Json }).ToListAsync(ct);
        return rows.Select(r => new PublishedWorkflow(r.Id, r.Version, FlowPilotJson.ParseDefinition(r.Json))).ToList();
    }

    private async Task<List<(PublishedWorkflow Workflow, NodeDefinition Node)>> FindPublishedTriggersAsync(
        string triggerType, Func<NodeDefinition, bool> matches, CancellationToken ct) =>
        (await LoadPublishedAsync(ct))
            .SelectMany(w => w.Definition.Nodes.Where(n => n.Type == triggerType && matches(n)).Select(n => (w, n)))
            .ToList();

    private async Task<string> WorkflowNameAsync(WorkflowRunEntity run, CancellationToken ct) =>
        await db.WorkflowDefinitions.Where(d => d.Id == run.DefinitionId).Select(d => d.Name).FirstOrDefaultAsync(ct)
        ?? FlowPilotJson.ParseDefinition(run.DefinitionSnapshotJson).Name;

    private static string ConfigText(NodeDefinition node, string key) => FlowPilotJson.AsText(node.Config[key]).Trim();

    private static string NormalizePath(string path) => path.Trim().Trim('/').ToLowerInvariant();
}
