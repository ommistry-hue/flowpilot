using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core.Contracts;
using FlowPilot.Core.Engine;
using FlowPilot.Tests.Infrastructure;
using FlowPilot.Core.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace FlowPilot.Tests;

/// <summary>Leases, crashes, shutdown and concurrency: the guarantees behind at-least-once execution.</summary>
public sealed class DurabilityTests
{
    private static WorkflowDefinition GatedWorkflow() => new WorkflowBuilder()
        .Node("start", "trigger.manual")
        .Node("slow", "test.gated")
        .Node("after", "log", new { message = "done" })
        .Edge("start", "slow")
        .Edge("slow", "after")
        .Build();

    [Theory, Sqlite, Postgres]
    public async Task A_crashed_workers_item_is_picked_up_by_another_worker_after_the_lease_expires(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var runId = await engine.StartAsync(GatedWorkflow());

        // Worker A claims the trigger item and "crashes" before executing it.
        var crashed = engine.Create<WorkItemExecutor>();
        var claimed = Assert.Single(await crashed.ClaimAsync(10, CancellationToken.None));
        Assert.Empty(await engine.Executor.ClaimAsync(10, CancellationToken.None)); // still leased

        engine.Clock.Advance(TimeSpan.FromMinutes(6)); // lease is 5 minutes
        var completed = await engine.RunUntilIdleAsync(runId);

        Assert.Equal(RunStatus.Completed, completed.Status);
        Assert.Single(completed.Nodes, n => n.NodeId == "start");

        // The crashed worker coming back must not run the item again.
        await crashed.ExecuteAsync(claimed, CancellationToken.None);
        Assert.Single((await engine.GetRunAsync(runId)).Nodes, n => n.NodeId == "start");
    }

    [Theory, Sqlite, Postgres]
    public async Task Long_running_activities_keep_their_lease_alive(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider, o => o.LeaseDuration = TimeSpan.FromMilliseconds(300));
        var runId = await engine.StartAsync(GatedWorkflow());
        await RunTriggerAsync(engine);
        var gate = GatedActivity.Close(runId);

        var slowItem = Assert.Single(await engine.Executor.ClaimAsync(10, CancellationToken.None));
        var executing = engine.Executor.ExecuteAsync(slowItem, CancellationToken.None);
        await WaitUntilAsync(() => GatedActivity.Entered.GetValueOrDefault(runId) == 1);

        // Far past the original lease; only the heartbeat can have kept the item locked.
        engine.Clock.Advance(TimeSpan.FromMinutes(30));
        await Task.Delay(400);
        var rival = engine.Create<WorkItemExecutor>();
        Assert.Empty(await rival.ClaimAsync(10, CancellationToken.None));

        gate.SetResult();
        await executing;
        var completed = await engine.RunUntilIdleAsync(runId);

        Assert.Equal(RunStatus.Completed, completed.Status);
        Assert.Equal(1, GatedActivity.Entered[runId]);
    }

    [Theory, Sqlite, Postgres]
    public async Task Shutdown_releases_in_flight_items_so_they_run_again_immediately(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var runId = await engine.StartAsync(GatedWorkflow());
        await RunTriggerAsync(engine);
        var gate = GatedActivity.Close(runId);

        var slowItem = Assert.Single(await engine.Executor.ClaimAsync(10, CancellationToken.None));
        using var shutdown = new CancellationTokenSource();
        var executing = engine.Executor.ExecuteAsync(slowItem, shutdown.Token);
        await WaitUntilAsync(() => GatedActivity.Entered.GetValueOrDefault(runId) == 1);

        await shutdown.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => executing);

        var item = await engine.WithDbAsync(db => db.WorkItems.SingleAsync(w => w.Id == slowItem));
        Assert.Null(item.LockedBy);
        Assert.DoesNotContain((await engine.GetRunAsync(runId)).Nodes, n => n.NodeId == "slow"); // interrupted attempt leaves no trace

        gate.SetResult();
        var completed = await engine.RunUntilIdleAsync(runId, advanceClock: false); // no clock advance needed
        Assert.Equal(RunStatus.Completed, completed.Status);
        Assert.Equal(NodeExecutionStatus.Completed, completed.Nodes.Single(n => n.NodeId == "slow").Status);
    }

    [Theory, Sqlite, Postgres]
    public async Task Concurrent_branches_writing_variables_lose_no_updates(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        const int branches = 8;
        var builder = new WorkflowBuilder().Variables(new { seed = true }).Node("start", "trigger.manual");
        for (var i = 0; i < branches; i++)
            builder.Node($"set{i}", "variable.set", new { name = $"v{i}", value = $"{{{{ {i} * 10 }}}}" }).Edge("start", $"set{i}");

        var runId = await engine.StartAsync(builder.Build());
        var run = await engine.RunUntilIdleAsync(runId, parallel: true);

        Assert.Equal(RunStatus.Completed, run.Status);
        Assert.True(run.Variables["seed"]!.GetValue<bool>());
        for (var i = 0; i < branches; i++)
            Assert.Equal(i * 10, run.Variables[$"v{i}"]!.GetValue<int>());
        Assert.Equal(branches, run.Nodes.Count(n => n.NodeId.StartsWith("set") && n.Status == NodeExecutionStatus.Completed));
    }

    [Theory, Sqlite, Postgres]
    public async Task Retrying_a_failed_run_restores_the_failed_node_and_every_dropped_branch(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("flaky", "test.flaky", new { failTimes = 1 })
            .Node("approve", "approval", new { title = "Ship it?" })
            .Node("join", "flow.join")
            .Node("after", "log", new { message = "{{ Object.keys(input).sort().join(',') }}" })
            .Edge("start", "flaky").Edge("start", "approve")
            .Edge("flaky", "join").Edge("approve", "join", Outcomes.Approved)
            .Edge("join", "after")
            .Build();

        var runId = await engine.StartAsync(workflow, new JsonObject { ["x"] = 1 });
        var failed = await engine.RunUntilIdleAsync(runId);
        Assert.Equal(RunStatus.Failed, failed.Status);
        Assert.Contains("boom #1", failed.Error);
        Assert.All(failed.Bookmarks, b => Assert.NotNull(b.ResolvedAt));

        Assert.True(await engine.WithRuntimeAsync(r => r.RetryAsync(runId)));
        Assert.False(await engine.WithRuntimeAsync(r => r.RetryAsync(runId))); // only failed runs

        var suspended = await engine.RunUntilIdleAsync(runId);
        Assert.Equal(RunStatus.Suspended, suspended.Status);
        Assert.Null(suspended.Error);
        var approval = Assert.Single(suspended.Bookmarks, b => b.ResolvedAt is null);

        await engine.WithRuntimeAsync(r => r.ResumeAsync(approval.Id, new JsonObject { ["approved"] = true }));
        var completed = await engine.RunUntilIdleAsync(runId);

        Assert.Equal(RunStatus.Completed, completed.Status);
        Assert.Equal("approve,flaky", completed.Nodes.Last(n => n.NodeId == "after").Output!["message"]!.GetValue<string>());
    }

    [Theory, Sqlite, Postgres]
    public async Task Activities_that_throw_or_cancel_themselves_fail_the_node_and_release_the_run(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider, o => o.LeaseDuration = TimeSpan.FromMilliseconds(300));
        foreach (var mode in new[] { "cancel", "crash" })
        {
            var workflow = new WorkflowBuilder()
                .Node("start", "trigger.manual")
                .Node("boom", "test.throws", new { mode })
                .Edge("start", "boom")
                .Build();

            var run = await engine.RunAsync(workflow);
            await Task.Delay(400); // a leaked heartbeat would have renewed something by now

            Assert.Equal(RunStatus.Failed, run.Status);
            var boom = run.Nodes.Single(n => n.NodeId == "boom");
            Assert.Equal(NodeExecutionStatus.Failed, boom.Status);
            Assert.Contains(mode == "cancel" ? "cancelled" : "Plugin bug", boom.Error);
            Assert.Equal(0, await engine.WithDbAsync(db => db.WorkItems.CountAsync(w => w.RunId == run.Id)));
        }
    }

    [Theory, Sqlite, Postgres]
    public async Task Cancelling_a_run_aborts_its_running_activity(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var runId = await engine.StartAsync(GatedWorkflow());
        await RunTriggerAsync(engine);
        GatedActivity.Close(runId); // never opened: only cancellation can end the activity

        var slowItem = Assert.Single(await engine.Executor.ClaimAsync(10, CancellationToken.None));
        var executing = engine.Executor.ExecuteAsync(slowItem, CancellationToken.None);
        await WaitUntilAsync(() => GatedActivity.Entered.GetValueOrDefault(runId) == 1);

        Assert.True(await engine.WithRuntimeAsync(r => r.CancelAsync(runId)));
        await executing.WaitAsync(TimeSpan.FromSeconds(10));

        var run = await engine.GetRunAsync(runId);
        Assert.Equal(RunStatus.Cancelled, run.Status);
        Assert.Equal(NodeExecutionStatus.Cancelled, run.Nodes.Single(n => n.NodeId == "slow").Status);
        Assert.DoesNotContain(run.Nodes, n => n.NodeId == "after");
    }

    [Theory, Sqlite, Postgres]
    public async Task Retrying_after_a_resolved_but_unprocessed_approval_does_not_fire_it_twice(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("approve", "approval", new { title = "OK?" })
            .Node("approvedLog", "log", new { message = "approved" })
            .Node("wait", "wait.event", new { @event = "go" })
            .Node("flaky", "test.flaky", new { failTimes = 1 })
            .Edge("start", "approve").Edge("approve", "approvedLog", Outcomes.Approved)
            .Edge("start", "wait").Edge("wait", "flaky")
            .Build();

        var runId = await engine.StartAsync(workflow);
        await engine.RunUntilIdleAsync(runId);
        var approval = (await engine.GetRunAsync(runId)).Bookmarks.Single(b => b.Kind == BookmarkKind.Approval);

        // The decision is recorded, but its resume item has not run yet when the other branch fails the run.
        await engine.WithRuntimeAsync(r => r.ResumeAsync(approval.Id, new JsonObject { ["approved"] = true }));
        await engine.WithRuntimeAsync(r => r.PublishEventAsync("go", null, null));
        await ExecuteOnlyAsync(engine, runId, "wait");
        await ExecuteOnlyAsync(engine, runId, "flaky");
        Assert.Equal(RunStatus.Failed, (await engine.GetRunAsync(runId)).Status);

        Assert.True(await engine.WithRuntimeAsync(r => r.RetryAsync(runId)));
        var completed = await engine.RunUntilIdleAsync(runId);

        Assert.Equal(RunStatus.Completed, completed.Status);
        Assert.Single(completed.Nodes, n => n.NodeId == "approvedLog");
        Assert.Single(completed.Nodes, n => n.NodeId == "approve" && n.Status == NodeExecutionStatus.Completed);
        Assert.DoesNotContain(completed.Bookmarks, b => b.ResolvedAt is null);
    }

    [Theory, Sqlite, Postgres]
    public async Task Runs_exceeding_the_step_limit_fail_with_a_clear_error(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider, o => o.Engine.MaxStepsPerRun = 20);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("each", "loop.forEach", new { items = "Array.from({ length: 100 }, (_, i) => i)" })
            .Node("body", "log", new { message = "{{ item }}" })
            .Edge("start", "each").Edge("each", "body", Outcomes.Item).Edge("body", "each")
            .Build();

        var run = await engine.RunAsync(workflow);

        Assert.Equal(RunStatus.Failed, run.Status);
        Assert.Contains("exceeded 20 steps", run.Error);
        Assert.Equal(20, run.Nodes.Count);
    }

    [Theory, Sqlite, Postgres]
    public async Task Retention_deletes_only_finished_runs_older_than_the_window(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider, o => o.Retention.Days = 30);
        var workflow = new WorkflowBuilder().Node("start", "trigger.manual").Node("log", "log", new { message = "x" }).Edge("start", "log").Build();
        var waiting = new WorkflowBuilder().Node("start", "trigger.manual").Node("ask", "approval", new { title = "?" }).Edge("start", "ask").Build();

        var old = await engine.RunAsync(workflow);
        var oldSuspended = await engine.RunAsync(waiting);
        engine.Clock.Advance(TimeSpan.FromDays(31));
        var recent = await engine.RunAsync(workflow);

        var retention = engine.Create<RetentionService>();
        Assert.Equal(1, await retention.PurgeAsync());

        Assert.Null(await engine.WithScopeAsync(sp => sp.GetRequiredService<RunQueries>().GetAsync(old.Id)));
        Assert.Equal(0, await engine.WithDbAsync(db => db.NodeExecutions.CountAsync(e => e.RunId == old.Id)));
        Assert.NotNull(await engine.GetRunAsync(oldSuspended.Id)); // still waiting, never purged
        Assert.NotNull(await engine.GetRunAsync(recent.Id));
    }

    /// <summary>Claims everything due, then executes only the items for <paramref name="nodeId"/>; the rest stay leased.</summary>
    private static async Task ExecuteOnlyAsync(EngineHarness engine, Guid runId, string nodeId)
    {
        await engine.Executor.ClaimAsync(50, CancellationToken.None);
        var ids = await engine.WithDbAsync(db => db.WorkItems
            .Where(w => w.RunId == runId && w.NodeId == nodeId && w.LockedBy == engine.Executor.WorkerId)
            .Select(w => w.Id).ToListAsync());
        Assert.NotEmpty(ids);
        foreach (var id in ids) await engine.Executor.ExecuteAsync(id, CancellationToken.None);
    }
    private static async Task RunTriggerAsync(EngineHarness engine) =>
        await engine.Executor.ExecuteAsync(Assert.Single(await engine.Executor.ClaimAsync(10, CancellationToken.None)), CancellationToken.None);

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (!condition()) await Task.Delay(10, timeout.Token);
    }
}
