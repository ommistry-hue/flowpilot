using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core.Contracts;
using FlowPilot.Core.Engine;
using FlowPilot.Core.Persistence;
using FlowPilot.Core.Services;
using FlowPilot.Tests.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace FlowPilot.Tests;

/// <summary>End-to-end engine behaviour. Every theory runs on SQLite, and on PostgreSQL when configured.</summary>
public sealed class EngineTests
{
    private static NodeExecutionDto Node(RunDetail run, string nodeId) => run.Nodes.Last(n => n.NodeId == nodeId);

    private static string Message(RunDetail run, string nodeId) => Node(run, nodeId).Output!["message"]!.GetValue<string>();

    [Theory, Sqlite, Postgres]
    public async Task Linear_flow_runs_every_node_in_order_and_completes(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("double", "script", new { code = "return { value: input.value * 2 };" })
            .Node("log", "log", new { message = "Value is {{ input.value }}" })
            .Edge("start", "double")
            .Edge("double", "log")
            .Build();

        var run = await engine.RunAsync(workflow, new JsonObject { ["value"] = 21 });

        Assert.Equal(RunStatus.Completed, run.Status);
        Assert.Equal(["start", "double", "log"], run.Nodes.Select(n => n.NodeId));
        Assert.All(run.Nodes, n => Assert.Equal(NodeExecutionStatus.Completed, n.Status));
        Assert.Equal("Value is 42", Message(run, "log"));
        Assert.NotNull(run.CompletedAt);
    }

    [Theory, Sqlite, Postgres]
    public async Task Condition_follows_the_matching_branch_only(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("check", "condition", new { expression = "input.total > 100" })
            .Node("big", "log", new { message = "big" })
            .Node("small", "log", new { message = "small" })
            .Edge("start", "check")
            .Edge("check", "big", Outcomes.True)
            .Edge("check", "small", Outcomes.False)
            .Build();

        foreach (var (total, expected) in new[] { (150, "big"), (50, "small") })
        {
            var run = await engine.RunAsync(workflow, new JsonObject { ["total"] = total });

            Assert.Equal(RunStatus.Completed, run.Status);
            Assert.Equal(["start", "check", expected], run.Nodes.Select(n => n.NodeId));
            Assert.Equal(total > 100 ? Outcomes.True : Outcomes.False, Node(run, "check").Outcome);
        }
    }

    [Theory, Sqlite, Postgres]
    public async Task Switch_takes_the_first_matching_case_or_default(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("route", "switch", new
            {
                cases = new[]
                {
                    new { name = "vip", expression = "input.tier === 'gold'" },
                    new { name = "regular", expression = "input.tier === 'silver' || input.tier === 'gold'" },
                },
            })
            .Node("vip", "log", new { message = "vip" })
            .Node("regular", "log", new { message = "regular" })
            .Node("fallback", "log", new { message = "fallback" })
            .Edge("start", "route")
            .Edge("route", "vip", "vip")
            .Edge("route", "regular", "regular")
            .Edge("route", "fallback", "default")
            .Build();

        foreach (var (tier, expected) in new[] { ("gold", "vip"), ("silver", "regular"), ("none", "fallback") })
        {
            var run = await engine.RunAsync(workflow, new JsonObject { ["tier"] = tier });

            Assert.Equal(RunStatus.Completed, run.Status);
            Assert.Equal(expected, run.Nodes.Last().NodeId);
        }
    }

    [Theory, Sqlite, Postgres]
    public async Task Parallel_branches_meet_at_a_join_that_merges_outputs_by_source(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("fan", "flow.parallel")
            .Node("a", "script", new { code = "return 'A';" })
            .Node("b", "script", new { code = "return 'B';" })
            .Node("c", "script", new { code = "return 'C';" })
            .Node("join", "flow.join", new { mode = "all" })
            .Node("after", "script", new { code = "return input.a + input.b + input.c;" })
            .Edge("start", "fan")
            .Edge("fan", "a").Edge("fan", "b").Edge("fan", "c")
            .Edge("a", "join").Edge("b", "join").Edge("c", "join")
            .Edge("join", "after")
            .Build();

        var run = await engine.RunAsync(workflow);

        Assert.Equal(RunStatus.Completed, run.Status);
        Assert.Single(run.Nodes, n => n.NodeId == "join");
        Assert.Equal("ABC", Node(run, "after").Output!.GetValue<string>());
    }

    [Theory, Sqlite, Postgres]
    public async Task Join_in_any_mode_fires_once_on_the_first_arrival(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("a", "script", new { code = "return 1;" })
            .Node("b", "script", new { code = "return 2;" })
            .Node("join", "flow.join", new { mode = "any" })
            .Node("after", "log", new { message = "first" })
            .Edge("start", "a").Edge("start", "b")
            .Edge("a", "join").Edge("b", "join")
            .Edge("join", "after")
            .Build();

        var run = await engine.RunAsync(workflow);

        Assert.Equal(RunStatus.Completed, run.Status);
        Assert.Single(run.Nodes, n => n.NodeId == "after");
        Assert.Single(Node(run, "join").Output!.AsObject());
    }

    [Theory, Sqlite, Postgres]
    public async Task ForEach_runs_the_body_per_item_with_item_and_index_in_scope(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Variables(new { total = 0 })
            .Node("start", "trigger.manual")
            .Node("each", "loop.forEach", new { items = "input.numbers" })
            .Node("label", "script", new { code = "return index + ':' + item;" })
            .Node("add", "variable.set", new { name = "total", value = "{{ vars.total + item }}" })
            .Node("done", "log", new { message = "{{ input.count }} items, total {{ vars.total }}" })
            .Edge("start", "each")
            .Edge("each", "label", Outcomes.Item)
            .Edge("label", "add")
            .Edge("add", "each")
            .Edge("each", "done", Outcomes.Done)
            .Build();

        var run = await engine.RunAsync(workflow, new JsonObject { ["numbers"] = new JsonArray(1, 2, 3) });

        Assert.Equal(RunStatus.Completed, run.Status);
        Assert.Equal(["0:1", "1:2", "2:3"], run.Nodes.Where(n => n.NodeId == "label").Select(n => n.Output!.GetValue<string>()));
        Assert.Equal(6, run.Variables["total"]!.GetValue<int>());
        Assert.Equal("3 items, total 6", Message(run, "done"));
    }

    [Theory, Sqlite, Postgres]
    public async Task ForEach_over_an_empty_list_goes_straight_to_done(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("each", "loop.forEach", new { items = "[]" })
            .Node("body", "log", new { message = "never" })
            .Node("done", "log", new { message = "finished" })
            .Edge("start", "each")
            .Edge("each", "body", Outcomes.Item)
            .Edge("body", "each")
            .Edge("each", "done", Outcomes.Done)
            .Build();

        var run = await engine.RunAsync(workflow);

        Assert.Equal(RunStatus.Completed, run.Status);
        Assert.DoesNotContain(run.Nodes, n => n.NodeId == "body");
        Assert.Contains(run.Nodes, n => n.NodeId == "done");
    }

    [Theory, Sqlite, Postgres]
    public async Task Failed_node_is_retried_with_backoff_until_it_succeeds(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("flaky", "test.flaky", new { failTimes = 2 },
                new RetryPolicy { MaxAttempts = 3, InitialDelayMs = 1000, BackoffMultiplier = 2, MaxDelayMs = 60_000 })
            .Edge("start", "flaky")
            .Build();

        var startedAt = engine.Clock.GetUtcNow();
        var run = await engine.RunAsync(workflow);

        Assert.Equal(RunStatus.Completed, run.Status);
        var attempts = run.Nodes.Where(n => n.NodeId == "flaky").ToList();
        Assert.Equal([1, 2, 3], attempts.Select(a => a.Attempt));
        Assert.Equal([NodeExecutionStatus.Failed, NodeExecutionStatus.Failed, NodeExecutionStatus.Completed], attempts.Select(a => a.Status));
        Assert.Equal(TimeSpan.FromSeconds(3), engine.Clock.GetUtcNow() - startedAt); // 1s + 2s backoff
    }

    [Theory, Sqlite, Postgres]
    public async Task Exhausted_retries_follow_the_error_edge(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("flaky", "test.flaky", new { failTimes = 10 }, new RetryPolicy { MaxAttempts = 2, InitialDelayMs = 10 })
            .Node("handler", "log", new { message = "Recovered from {{ input.nodeId }}: {{ input.error }}" })
            .Edge("start", "flaky")
            .Edge("flaky", "handler", Outcomes.Error)
            .Build();

        var run = await engine.RunAsync(workflow);

        Assert.Equal(RunStatus.Completed, run.Status);
        Assert.Equal(2, run.Nodes.Count(n => n.NodeId == "flaky" && n.Status == NodeExecutionStatus.Failed));
        Assert.Equal("Recovered from flaky: boom #2", Message(run, "handler"));
    }

    [Theory, Sqlite, Postgres]
    public async Task Approval_suspends_the_run_until_a_decision_resumes_it(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("approve", "approval", new { title = "Pay {{ input.amount }}?", assignee = "boss" })
            .Node("approvedLog", "log", new { message = "approved: {{ input.comment }}" })
            .Node("rejectedLog", "log", new { message = "rejected" })
            .Edge("start", "approve")
            .Edge("approve", "approvedLog", Outcomes.Approved)
            .Edge("approve", "rejectedLog", Outcomes.Rejected)
            .Build();

        foreach (var (approve, expected) in new[] { (true, "approvedLog"), (false, "rejectedLog") })
        {
            var suspended = await engine.RunAsync(workflow, new JsonObject { ["amount"] = 99 });
            Assert.Equal(RunStatus.Suspended, suspended.Status);
            Assert.Equal(NodeExecutionStatus.Suspended, Node(suspended, "approve").Status);

            var approvals = await engine.WithScopeAsync(sp => sp.GetRequiredService<RunQueries>().ApprovalsAsync(pending: true));
            var approval = Assert.Single(approvals);
            Assert.Equal("Pay 99?", approval.Title);

            var decision = new JsonObject { ["approved"] = approve, ["comment"] = "looks fine" };
            Assert.True(await engine.WithRuntimeAsync(r => r.ResumeAsync(approval.Id, decision, BookmarkKind.Approval)));
            Assert.False(await engine.WithRuntimeAsync(r => r.ResumeAsync(approval.Id, decision, BookmarkKind.Approval)));

            var completed = await engine.RunUntilIdleAsync(suspended.Id);
            Assert.Equal(RunStatus.Completed, completed.Status);
            Assert.Equal(expected, completed.Nodes.Last().NodeId);
            Assert.Single(completed.Nodes, n => n.NodeId == "approve"); // resume reuses the suspended execution row
            Assert.Equal(NodeExecutionStatus.Completed, Node(completed, "approve").Status);
        }
    }

    [Theory, Sqlite, Postgres]
    public async Task Delay_suspends_until_the_resume_time_then_continues(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("wait", "delay", new { durationMs = 60_000 })
            .Node("after", "log", new { message = "later" })
            .Edge("start", "wait")
            .Edge("wait", "after")
            .Build();

        var runId = await engine.StartAsync(workflow);
        var suspended = await engine.RunUntilIdleAsync(runId, advanceClock: false);
        Assert.Equal(RunStatus.Suspended, suspended.Status);
        Assert.Equal(BookmarkKind.Delay, Assert.Single(suspended.Bookmarks).Kind);

        engine.Clock.Advance(TimeSpan.FromSeconds(30));
        Assert.Equal(RunStatus.Suspended, (await engine.RunUntilIdleAsync(runId, advanceClock: false)).Status);

        engine.Clock.Advance(TimeSpan.FromSeconds(30));
        var completed = await engine.RunUntilIdleAsync(runId, advanceClock: false);
        Assert.Equal(RunStatus.Completed, completed.Status);
        Assert.Contains(completed.Nodes, n => n.NodeId == "after");
    }

    [Theory, Sqlite, Postgres]
    public async Task Cancel_stops_a_suspended_run_and_closes_its_bookmarks(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("a", "approval", new { title = "First" })
            .Node("b", "delay", new { durationMs = 5_000 })
            .Edge("start", "a")
            .Edge("start", "b")
            .Build();

        var runId = await engine.StartAsync(workflow);
        Assert.Equal(RunStatus.Suspended, (await engine.RunUntilIdleAsync(runId, advanceClock: false)).Status);

        Assert.True(await engine.WithRuntimeAsync(r => r.CancelAsync(runId)));
        Assert.False(await engine.WithRuntimeAsync(r => r.CancelAsync(runId)));

        var cancelled = await engine.RunUntilIdleAsync(runId);
        Assert.Equal(RunStatus.Cancelled, cancelled.Status);
        Assert.All(cancelled.Bookmarks, b => Assert.NotNull(b.ResolvedAt));
        Assert.DoesNotContain(cancelled.Nodes, n => n.Status is NodeExecutionStatus.Suspended or NodeExecutionStatus.Running);
        Assert.Equal(2, cancelled.Nodes.Count(n => n.Status == NodeExecutionStatus.Cancelled));
    }

    [Theory, Sqlite, Postgres]
    public async Task Wait_event_resumes_only_for_the_matching_correlation_key(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("wait", "wait.event", new { @event = "payment.received", correlationKey = "{{ input.orderId }}" })
            .Node("after", "log", new { message = "paid {{ input.amount }}" })
            .Edge("start", "wait")
            .Edge("wait", "after")
            .Build();

        var run = await engine.RunAsync(workflow, new JsonObject { ["orderId"] = "A-1" });
        Assert.Equal(RunStatus.Suspended, run.Status);

        Task<EventDispatchResult> Dispatch(string key) =>
            engine.WithRuntimeAsync(r => r.PublishEventAsync("payment.received", new JsonObject { ["amount"] = 10 }, key));

        Assert.Equal(0, (await Dispatch("B-2")).Resumed);
        Assert.Equal(1, (await Dispatch("A-1")).Resumed);

        var completed = await engine.RunUntilIdleAsync(run.Id);
        Assert.Equal(RunStatus.Completed, completed.Status);
        Assert.Equal("paid 10", Message(completed, "after"));
    }

    [Theory, Sqlite, Postgres]
    public async Task Templates_keep_js_types_when_stored_in_variables(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("n", "variable.set", new { name = "count", value = "{{ input.a + input.b }}" })
            .Node("list", "variable.set", new { name = "tags", value = "{{ ['x', 'y'] }}" })
            .Node("text", "variable.set", new { name = "label", value = "Sum: {{ trigger.a + trigger.b }}" })
            .Edge("start", "n").Edge("n", "list").Edge("list", "text")
            .Build();

        var run = await engine.RunAsync(workflow, new JsonObject { ["a"] = 2, ["b"] = 3 });

        Assert.Equal(RunStatus.Completed, run.Status);
        Assert.Equal(System.Text.Json.JsonValueKind.Number, run.Variables["count"]!.GetValueKind());
        Assert.Equal(5, run.Variables["count"]!.GetValue<int>());
        Assert.Equal(["x", "y"], run.Variables["tags"]!.AsArray().Select(t => t!.GetValue<string>()));
        Assert.Equal("Sum: 5", run.Variables["label"]!.GetValue<string>());
    }

    [Theory, Sqlite, Postgres]
    public async Task Runaway_scripts_and_templates_fail_the_node_instead_of_hanging(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("loop", "script", new { code = "while (true) {}" })
            .Node("hog", "script", new { code = "const a = []; while (true) a.push(new Array(10000).fill(1));" })
            .Node("template", "log", new { message = "{{ (() => { while (true) {} })() }}" })
            .Node("clr", "script", new { code = "return System.IO.File.ReadAllText('secrets.txt');" })
            .Node("sink", "log", new { message = "recovered" })
            .Edge("start", "loop").Edge("start", "hog").Edge("start", "template").Edge("start", "clr")
            .Edge("loop", "sink", Outcomes.Error).Edge("hog", "sink", Outcomes.Error)
            .Edge("template", "sink", Outcomes.Error).Edge("clr", "sink", Outcomes.Error)
            .Build();

        var run = await engine.RunAsync(workflow);

        Assert.Equal(RunStatus.Completed, run.Status);
        Assert.Contains("statements", Node(run, "loop").Error, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("memory", Node(run, "hog").Error, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("statements", Node(run, "template").Error, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("System is not defined", Node(run, "clr").Error);
        Assert.Equal(4, run.Nodes.Count(n => n.NodeId == "sink"));
    }

    [Theory, Sqlite, Postgres]
    public async Task Code_registered_plugin_activity_runs_in_a_workflow(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("slug", "text.transform", new { text = "{{ input.title }}", mode = "slug" })
            .Edge("start", "slug")
            .Build();

        var run = await engine.RunAsync(workflow, new JsonObject { ["title"] = "Héllo, Flow Pilot!" });

        Assert.Equal(RunStatus.Completed, run.Status);
        Assert.Equal("hello-flow-pilot", Node(run, "slug").Output!["text"]!.GetValue<string>());
    }

    [Theory, Sqlite, Postgres]
    public async Task Seeded_expense_approval_runs_parallel_checks_then_waits_for_approval(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var run = await engine.RunAsync(SampleWorkflows.ExpenseApproval(), new JsonObject { ["amount"] = 1500 });

        Assert.Equal(RunStatus.Suspended, run.Status);
        var join = Node(run, "join");
        Assert.Equal("high", join.Output!["risk"]!["level"]!.GetValue<string>());
        Assert.Equal(5000, join.Output!["budget"]!["remaining"]!.GetValue<int>());

        var bookmark = Assert.Single(run.Bookmarks);
        Assert.Equal("Approve expense of 1500", bookmark.Payload!["title"]!.GetValue<string>());

        await engine.WithRuntimeAsync(r => r.ResumeAsync(bookmark.Id, new JsonObject { ["approved"] = true, ["comment"] = "ok" }));
        var completed = await engine.RunUntilIdleAsync(run.Id);

        Assert.Equal(RunStatus.Completed, completed.Status);
        Assert.Equal("Expense approved: ok", Message(completed, "approved"));
    }

    [Theory, Sqlite, Postgres]
    public async Task Seeded_order_line_totals_sums_lines_in_a_loop(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var run = await engine.RunAsync(SampleWorkflows.OrderLineTotals());

        Assert.Equal(RunStatus.Completed, run.Status);
        Assert.Equal(30.9, run.Variables["total"]!.GetValue<double>(), precision: 6);
        Assert.Equal(3, run.Nodes.Count(n => n.NodeId == "lineTotal"));
    }

    [Theory, Sqlite, Postgres]
    public async Task Webhook_starts_the_published_workflow_that_matches_path_and_method(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider);
        var workflowId = await engine.WithScopeAsync(async sp =>
        {
            var store = sp.GetRequiredService<WorkflowStore>();
            var created = await store.CreateAsync(SampleWorkflows.BigOrderAlert());
            Assert.Equal(1, (await store.PublishAsync(created.Id))!.Version);
            return created.Id;
        });

        var payload = new JsonObject { ["method"] = "POST", ["body"] = new JsonObject { ["id"] = 7, ["total"] = 20 } };

        Assert.False((await engine.WithRuntimeAsync(r => r.TriggerWebhookAsync(new WebhookRequest("orders", "GET", payload, [], null, null)))).Matched);
        var runId = Assert.Single((await engine.WithRuntimeAsync(r => r.TriggerWebhookAsync(new WebhookRequest("/orders/", "POST", payload, [], null, null)))).RunIds);

        var run = await engine.RunUntilIdleAsync(runId);
        Assert.Equal(RunStatus.Completed, run.Status);
        Assert.Equal(workflowId, run.WorkflowId);
        Assert.Equal(1, run.Version);
        Assert.Equal("Order 7 (20) is below the threshold", Message(run, "small"));
    }

    [Theory, Sqlite, Postgres]
    public async Task Private_network_targets_are_blocked_when_configured(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider, o => o.Http.BlockPrivateNetworks = true);
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("call", "http.request", new { url = "http://127.0.0.1:9/internal", method = "GET" })
            .Edge("start", "call")
            .Build();

        var run = await engine.RunAsync(workflow);

        Assert.Equal(RunStatus.Failed, run.Status);
        Assert.Contains("Blocked request to '127.0.0.1'", Node(run, "call").Error);
    }
}
