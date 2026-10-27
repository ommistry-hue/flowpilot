using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core.Activities;
using FlowPilot.Core.Contracts;
using FlowPilot.Core.Expressions;
using FlowPilot.Core.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FlowPilot.Core.Engine;

/// <summary>
/// Claims work items and executes them: one item is one node execution. The result is committed in a
/// single transaction together with the successor tokens, so a crash before commit simply re-runs the node.
/// </summary>
public sealed class WorkItemExecutor(
    IServiceScopeFactory scopeFactory,
    IWorkItemClaimer claimer,
    ActivityRegistry registry,
    IRunEventSink events,
    WorkerSignal signal,
    RunCancellations cancellations,
    SecretStore secrets,
    TimeProvider clock,
    IOptions<FlowPilotOptions> options,
    ILoggerFactory loggerFactory)
{
    private readonly ILogger _logger = loggerFactory.CreateLogger<WorkItemExecutor>();

    public string WorkerId { get; } = $"{Environment.MachineName}:{Environment.ProcessId}:{Guid.NewGuid():N}";

    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    public async Task<IReadOnlyList<Guid>> ClaimAsync(int maxItems, CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<FlowPilotDbContext>();
        var now = Now;
        return await claimer.ClaimAsync(db, WorkerId, maxItems, now, now + options.Value.LeaseDuration, cancellationToken);
    }

    /// <param name="workItemId">The claimed work item to run.</param>
    /// <param name="cancellationToken">The host's stopping token. Cancelling it hands the item back instead of failing it.</param>
    public async Task ExecuteAsync(Guid workItemId, CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<FlowPilotDbContext>();

        var item = await db.WorkItems.AsNoTracking().FirstOrDefaultAsync(w => w.Id == workItemId && w.LockedBy == WorkerId, cancellationToken);
        if (item is null) return;

        var snapshot = await db.WorkflowRuns.AsNoTracking().FirstOrDefaultAsync(r => r.Id == item.RunId, cancellationToken);
        if (snapshot is null || snapshot.IsFinished)
        {
            await db.WorkItems.Where(w => w.Id == item.Id).ExecuteDeleteAsync(cancellationToken);
            return;
        }

        var graph = new WorkflowGraph(FlowPilotJson.ParseDefinition(snapshot.DefinitionSnapshotJson));
        var node = graph.FindNode(item.NodeId) ?? new NodeDefinition { Id = item.NodeId, Type = "(missing)" };

        // 'abort' stops the activity when the run is cancelled or failed elsewhere, the lease is lost, or the host stops.
        using var abort = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        using var registration = cancellations.Register(item.RunId, abort);
        using var heartbeat = new CancellationTokenSource();
        var renewing = KeepLeaseAliveAsync(item.Id, abort, heartbeat.Token);

        async Task StopHeartbeatAsync()
        {
            if (!heartbeat.IsCancellationRequested) await heartbeat.CancelAsync();
            await renewing;
        }

        Guid? executionId = null;
        JsonObject variablesBefore = [], variables = [], nodeStateBefore = [], nodeState = [];
        ActivityResult result;
        try
        {
            var begun = await BeginAsync(db, item, node, cancellationToken);
            if (begun.StepLimitReached)
            {
                await StopHeartbeatAsync();
                cancellations.Cancel(item.RunId);
                await events.RunUpdatedAsync(DtoMapper.ToSummary(begun.Run, graph.Definition.Name));
                return;
            }

            executionId = begun.Execution!.Id;
            await events.NodeUpdatedAsync(DtoMapper.ToDto(begun.Execution));
            await events.RunUpdatedAsync(DtoMapper.ToSummary(begun.Run, graph.Definition.Name));

            // The activity mutates copies; the commit applies only what changed onto the latest run state.
            var state = RunState.Load(begun.Run);
            variablesBefore = (JsonObject)state.Variables.DeepClone();
            variables = (JsonObject)state.Variables.DeepClone();
            nodeStateBefore = (JsonObject)state.StateOf(node.Id).DeepClone();
            nodeState = (JsonObject)state.StateOf(node.Id).DeepClone();

            result = await RunActivityAsync(services, begun.Run, graph, node, item, state, variables, nodeState, abort.Token, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            await StopHeartbeatAsync();
            await ReleaseAsync(item.Id, executionId);
            throw;
        }
        catch (Exception ex)
        {
            // Engine-side failure (database, serialization...). Fail the node rather than leave the run hanging.
            _logger.LogError("Executing node {NodeId} of run {RunId} failed: {Error}", node.Id, item.RunId, secrets.Mask(ex.ToString()));
            result = ActivityResult.Fail($"Internal error: {ex.Message}");
        }
        finally
        {
            await StopHeartbeatAsync();
        }

        // The activity has run; persist its result even if the host is shutting down meanwhile.
        var commit = await CommitAsync(db, item, graph, node, executionId, result,
            variablesBefore, variables, nodeStateBefore, nodeState, CancellationToken.None);

        if (commit.RunEnded) cancellations.Cancel(item.RunId);
        if (commit.WorkAdded) signal.Notify();
        await events.NodeUpdatedAsync(DtoMapper.ToDto(commit.Execution));
        await events.RunUpdatedAsync(DtoMapper.ToSummary(commit.Run, graph.Definition.Name));
        if (commit.ApprovalsChanged) await events.ApprovalsChangedAsync();
    }

    private sealed record BeginResult(WorkflowRunEntity Run, NodeExecutionEntity? Execution, bool StepLimitReached);

    private async Task<BeginResult> BeginAsync(FlowPilotDbContext db, WorkItemEntity item, NodeDefinition node, CancellationToken ct) =>
        await db.InTransactionAsync(async () =>
        {
            var now = Now;
            var run = await db.WorkflowRuns.FirstAsync(r => r.Id == item.RunId, ct);
            if (run.Status == RunStatus.Pending)
            {
                run.Status = RunStatus.Running;
                run.StartedAt = now;
                run.ConcurrencyToken = Guid.NewGuid();
            }

            var maxSteps = options.Value.Engine.MaxStepsPerRun;
            if (maxSteps > 0 && await db.NodeExecutions.CountAsync(e => e.RunId == item.RunId, ct) >= maxSteps)
            {
                if (await db.WorkItems.FirstOrDefaultAsync(w => w.Id == item.Id && w.LockedBy == WorkerId, ct) is { } claimed)
                    db.WorkItems.Remove(claimed);
                await FailRunAsync(db, run, item,
                    $"The run exceeded {maxSteps} steps (FlowPilot:Engine:MaxStepsPerRun). Check for a loop that never ends.", now, ct);
                run.ConcurrencyToken = Guid.NewGuid();
                return new BeginResult(run, null, StepLimitReached: true);
            }

            // A resumed node continues the execution row it suspended in, so history shows one entry.
            var execution = item.ResumePayloadJson is null ? null : await db.NodeExecutions
                .Where(e => e.RunId == item.RunId && e.NodeId == item.NodeId && e.Status == NodeExecutionStatus.Suspended)
                .OrderByDescending(e => e.StartedAt)
                .FirstOrDefaultAsync(ct);

            if (execution is null)
            {
                execution = NewExecution(item, node, now);
                db.NodeExecutions.Add(execution);
            }
            execution.Status = NodeExecutionStatus.Running;
            execution.CompletedAt = null;
            return new BeginResult(run, execution, StepLimitReached: false);
        }, ct);

    private NodeExecutionEntity NewExecution(WorkItemEntity item, NodeDefinition node, DateTime now) => new()
    {
        Id = Guid.NewGuid(),
        RunId = item.RunId,
        NodeId = node.Id,
        NodeType = node.Type,
        Attempt = item.Attempt,
        InputJson = secrets.MaskJson(item.InputJson),
        StartedAt = now,
    };

    private async Task<ActivityResult> RunActivityAsync(
        IServiceProvider services, WorkflowRunEntity run, WorkflowGraph graph, NodeDefinition node, WorkItemEntity item,
        RunState state, JsonObject variables, JsonObject nodeState, CancellationToken abort, CancellationToken hostStopping)
    {
        var registration = registry.Find(node.Type);
        if (registration is null) return ActivityResult.Fail($"Unknown activity type '{node.Type}'.");

        var input = FlowPilotJson.ParseNode(item.InputJson);
        var evaluator = new JintExpressionEvaluator(BuildScope(run, graph, state, node.Id, input));

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(abort);
        if (node.TimeoutMs is > 0) timeout.CancelAfter(node.TimeoutMs.Value);

        try
        {
            var config = evaluator.EvaluateConfig(node.Config, registration.RawKeys);
            var activity = registry.Create(registration, services, config);
            return await activity.ExecuteAsync(new ActivityContext
            {
                RunId = run.Id,
                NodeId = node.Id,
                Attempt = item.Attempt,
                Config = config,
                Input = input,
                Variables = variables,
                NodeState = nodeState,
                ResumePayload = FlowPilotJson.ParseNode(item.ResumePayloadJson),
                Services = services,
                Logger = loggerFactory.CreateLogger($"FlowPilot.Activities.{node.Type}"),
                Expressions = evaluator,
            }, timeout.Token);
        }
        catch (OperationCanceledException) when (hostStopping.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException) when (abort.IsCancellationRequested)
        {
            return ActivityResult.Fail("Cancelled: the run ended or this worker lost its lease.");
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested)
        {
            return ActivityResult.Fail($"Timed out after {node.TimeoutMs} ms.");
        }
        catch (Exception ex)
        {
            // Includes cancellations the activity raised itself, such as an HttpClient timeout.
            if (ex is not (ExpressionException or InvalidOperationException or OperationCanceledException))
                _logger.LogWarning("Activity {Type} on node {NodeId} threw: {Error}", node.Type, node.Id, secrets.Mask(ex.ToString()));
            return ActivityResult.Fail(ex is OperationCanceledException ? $"The operation was cancelled: {ex.Message}" : ex.Message);
        }
    }
    private Dictionary<string, JsonNode?> BuildScope(WorkflowRunEntity run, WorkflowGraph graph, RunState state, string nodeId, JsonNode? input)
    {
        var nodes = new JsonObject();
        foreach (var (id, output) in state.Outputs)
            nodes[id] = new JsonObject { ["output"] = output.Clone() };

        var scope = new Dictionary<string, JsonNode?>
        {
            ["input"] = input,
            ["vars"] = state.Variables,
            ["nodes"] = nodes,
            ["trigger"] = FlowPilotJson.ParseNode(run.InputJson),
            ["run"] = new JsonObject { ["id"] = run.Id.ToString(), ["workflowId"] = run.DefinitionId.ToString() },
            ["secrets"] = secrets.ToScope(),
            ["item"] = null,
            ["index"] = null,
        };

        if (graph.EnclosingLoop(nodeId) is { } loopId
            && state.StateOf(loopId) is { } loop
            && loop["items"] is JsonArray items
            && loop["index"]?.GetValue<int>() is { } index && index < items.Count)
        {
            scope["item"] = items[index];
            scope["index"] = index;
        }
        return scope;
    }

    private sealed record CommitResult(WorkflowRunEntity Run, NodeExecutionEntity Execution, bool WorkAdded, bool ApprovalsChanged, bool RunEnded);

    private async Task<CommitResult> CommitAsync(
        FlowPilotDbContext db, WorkItemEntity item, WorkflowGraph graph, NodeDefinition node, Guid? executionId, ActivityResult result,
        JsonObject variablesBefore, JsonObject variablesAfter, JsonObject nodeStateBefore, JsonObject nodeStateAfter, CancellationToken ct) =>
        await db.InTransactionAsync(async () =>
        {
            var now = Now;
            var run = await db.WorkflowRuns.FirstAsync(r => r.Id == item.RunId, ct);
            var execution = executionId is { } id ? await db.NodeExecutions.FirstOrDefaultAsync(e => e.Id == id, ct) : null;
            if (execution is null)
            {
                execution = NewExecution(item, node, now);
                db.NodeExecutions.Add(execution);
            }
            var claimed = await db.WorkItems.FirstOrDefaultAsync(w => w.Id == item.Id && w.LockedBy == WorkerId, ct);
            execution.CompletedAt = now;

            if (claimed is null || run.IsFinished)
            {
                execution.Status = NodeExecutionStatus.Cancelled;
                execution.Error = run.IsFinished ? $"Run {run.Status.ToString().ToLowerInvariant()}." : "Lease lost; another worker took over this item.";
                if (claimed is not null) db.WorkItems.Remove(claimed);
                return new CommitResult(run, execution, false, false, false);
            }

            db.WorkItems.Remove(claimed);
            var state = RunState.Load(run);
            state.MergeVariables(variablesBefore, variablesAfter);
            if (!JsonNode.DeepEquals(nodeStateBefore, nodeStateAfter)) state.SetState(node.Id, nodeStateAfter);

            var tokens = new TokenWriter(db, graph, state, run.Id, now);
            var openedBookmark = false;
            var approvalsChanged = false;

            switch (result.Status)
            {
                case ActivityStatus.Completed:
                    execution.Status = NodeExecutionStatus.Completed;
                    execution.Outcome = result.Outcome;
                    execution.OutputJson = FlowPilotJson.ToJson(secrets.MaskNode(result.Output));
                    // Clone: the transaction may retry on a concurrency conflict, and a JsonNode can only have one parent.
                    state.Outputs[node.Id] = secrets.MaskNode(result.Output)?.DeepClone();
                    tokens.Route(node.Id, result.Outcome, result.Output);
                    break;

                case ActivityStatus.Suspended:
                    var request = result.Bookmark!;
                    execution.Status = NodeExecutionStatus.Suspended;
                    db.Bookmarks.Add(new BookmarkEntity
                    {
                        Id = Guid.NewGuid(),
                        RunId = run.Id,
                        NodeId = node.Id,
                        Kind = request.Kind,
                        CorrelationKey = request.CorrelationKey,
                        PayloadJson = FlowPilotJson.ToJson(secrets.MaskNode(request.Payload)),
                        ResumeAt = request.ResumeAt?.UtcDateTime,
                        CreatedAt = now,
                    });
                    openedBookmark = true;
                    approvalsChanged = request.Kind == BookmarkKind.Approval;
                    break;

                case ActivityStatus.Failed:
                    execution.Status = NodeExecutionStatus.Failed;
                    execution.Outcome = Outcomes.Error;
                    execution.Error = secrets.Mask(result.Error);
                    var maxAttempts = node.Retry?.MaxAttempts ?? 1;
                    if (item.Attempt < maxAttempts)
                    {
                        tokens.Add(new WorkItemEntity
                        {
                            NodeId = node.Id,
                            InputJson = item.InputJson,
                            ResumePayloadJson = item.ResumePayloadJson,
                            Attempt = item.Attempt + 1,
                            AvailableAt = now + RetryDelay(node.Retry!, item.Attempt),
                        });
                    }
                    else if (graph.HasOutgoing(node.Id, Outcomes.Error))
                    {
                        tokens.Route(node.Id, Outcomes.Error, new JsonObject
                        {
                            ["error"] = result.Error,
                            ["nodeId"] = node.Id,
                            ["input"] = FlowPilotJson.ParseNode(item.InputJson),
                        });
                    }
                    else
                    {
                        approvalsChanged = await FailRunAsync(db, run, claimed, $"Node '{node.Id}' failed: {secrets.Mask(result.Error)}", now, ct);
                    }
                    break;
            }

            if (run.Status != RunStatus.Failed)
            {
                var pendingItems = tokens.Added + await db.WorkItems.CountAsync(w => w.RunId == run.Id && w.Id != claimed.Id, ct);
                var openBookmarks = (openedBookmark ? 1 : 0) + await db.Bookmarks.CountAsync(b => b.RunId == run.Id && b.ResolvedAt == null, ct);
                run.Status = pendingItems > 0 ? RunStatus.Running : openBookmarks > 0 ? RunStatus.Suspended : RunStatus.Completed;
                if (run.Status == RunStatus.Completed) run.CompletedAt = now;
            }

            state.SaveTo(run, secrets);
            return new CommitResult(run, execution, tokens.Added > 0, approvalsChanged, run.Status == RunStatus.Failed);
        }, ct);

    /// <summary>
    /// Fails the run and drops its other branches. The failed node and every dropped token are saved so
    /// that retrying the run replays all of them, not only the node that failed.
    /// </summary>
    /// <returns>True when open approvals were closed.</returns>
    private static async Task<bool> FailRunAsync(FlowPilotDbContext db, WorkflowRunEntity run, WorkItemEntity failed, string error, DateTime now, CancellationToken ct)
    {
        var pending = await db.WorkItems.AsNoTracking()
            .Where(w => w.RunId == run.Id && w.Id != failed.Id)
            .Select(w => new RetryToken(w.NodeId, w.InputJson, w.ResumePayloadJson))
            .ToListAsync(ct);

        // Nodes still waiting on an open bookmark are re-entered from scratch on retry and open a fresh one.
        // A bookmark that was already resolved has a resume item among 'pending', so it is not added twice.
        var waitingNodes = await db.Bookmarks.AsNoTracking()
            .Where(b => b.RunId == run.Id && b.ResolvedAt == null)
            .Select(b => b.NodeId)
            .Distinct()
            .ToListAsync(ct);
        var suspendedRows = await db.NodeExecutions.AsNoTracking()
            .Where(e => e.RunId == run.Id && e.Status == NodeExecutionStatus.Suspended && waitingNodes.Contains(e.NodeId))
            .OrderByDescending(e => e.StartedAt)
            .ToListAsync(ct);
        var suspended = suspendedRows.DistinctBy(e => e.NodeId).Select(e => new RetryToken(e.NodeId, e.InputJson, null));

        run.Status = RunStatus.Failed;
        run.Error = error;
        run.CompletedAt = now;
        run.StartedAt ??= now;
        run.RetryTokensJson = FlowPilotJson.Serialize(
            new[] { new RetryToken(failed.NodeId, failed.InputJson, failed.ResumePayloadJson) }.Concat(pending).Concat(suspended));

        await db.WorkItems.Where(w => w.RunId == run.Id && w.Id != failed.Id).ExecuteDeleteAsync(ct);
        return await RunCleanup.StopOpenWorkAsync(db, run.Id, RunStatus.Failed, now, ct);
    }

    internal static TimeSpan RetryDelay(RetryPolicy policy, int failedAttempt)
    {
        var delay = policy.InitialDelayMs * Math.Pow(policy.BackoffMultiplier, failedAttempt - 1);
        return TimeSpan.FromMilliseconds(Math.Min(delay, policy.MaxDelayMs));
    }

    /// <summary>
    /// Extends the lease every third of its duration so long-running activities are not picked up twice.
    /// If the item is gone (run cancelled or failed) or now belongs to another worker, the activity is aborted.
    /// </summary>
    private async Task KeepLeaseAliveAsync(Guid workItemId, CancellationTokenSource abort, CancellationToken stop)
    {
        var lease = options.Value.LeaseDuration;
        try
        {
            while (true)
            {
                await Task.Delay(lease / 3, clock, stop);
                try
                {
                    using var scope = scopeFactory.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<FlowPilotDbContext>();
                    var lockedUntil = Now + lease;
                    var renewed = await db.WorkItems
                        .Where(w => w.Id == workItemId && w.LockedBy == WorkerId)
                        .ExecuteUpdateAsync(s => s.SetProperty(w => w.LockedUntil, (DateTime?)lockedUntil), stop);
                    if (renewed == 0)
                    {
                        _logger.LogInformation("Work item {WorkItemId} is no longer ours; aborting its activity", workItemId);
                        await abort.CancelAsync();
                        return;
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogWarning(ex, "Could not renew the lease on work item {WorkItemId}", workItemId);
                }
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested)
        {
        }
    }

    /// <summary>On shutdown, hand the item back immediately instead of waiting for the lease to expire.</summary>
    private async Task ReleaseAsync(Guid workItemId, Guid? executionId)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<FlowPilotDbContext>();
            var item = await db.WorkItems.AsNoTracking().FirstOrDefaultAsync(w => w.Id == workItemId && w.LockedBy == WorkerId);
            if (item is null) return;

            await db.WorkItems.Where(w => w.Id == workItemId && w.LockedBy == WorkerId)
                .ExecuteUpdateAsync(s => s.SetProperty(w => w.LockedBy, (string?)null).SetProperty(w => w.LockedUntil, (DateTime?)null));

            if (executionId is { } id)
            {
                var executions = db.NodeExecutions.Where(e => e.Id == id && e.Status == NodeExecutionStatus.Running);
                if (item.ResumePayloadJson is null)
                    await executions.ExecuteDeleteAsync();
                else
                    await executions.ExecuteUpdateAsync(s => s.SetProperty(e => e.Status, NodeExecutionStatus.Suspended));
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not release work item {WorkItemId}", workItemId);
        }
    }
}

internal sealed record RetryToken(string NodeId, string? InputJson, string? ResumePayloadJson);