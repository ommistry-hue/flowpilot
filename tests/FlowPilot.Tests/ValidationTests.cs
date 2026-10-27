using FlowPilot.Abstractions;
using FlowPilot.Core.Engine;
using FlowPilot.Core.Persistence;
using FlowPilot.Tests.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace FlowPilot.Tests;

public sealed class ValidationTests : IAsyncLifetime
{
    private EngineHarness _engine = null!;
    private WorkflowValidator Validator => _engine.Services.GetRequiredService<WorkflowValidator>();

    public async Task InitializeAsync() => _engine = await EngineHarness.CreateAsync();

    public async Task DisposeAsync() => await _engine.DisposeAsync();

    [Fact]
    public void Seeded_samples_are_valid()
    {
        foreach (var sample in SampleWorkflows.All())
        {
            var result = Validator.Validate(sample);
            Assert.True(result.Valid, $"{sample.Name}: {string.Join("; ", result.Errors.Select(e => e.Message))}");
        }
    }

    [Fact]
    public void Example_workflows_in_the_repository_are_valid()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "FlowPilot.slnx"))) root = root.Parent;
        var examples = Directory.GetFiles(Path.Combine(root!.FullName, "examples"), "*.json");

        Assert.NotEmpty(examples);
        foreach (var file in examples)
        {
            var result = Validator.Validate(FlowPilot.Core.FlowPilotJson.ParseDefinition(File.ReadAllText(file)));
            Assert.True(result.Valid, $"{Path.GetFileName(file)}: {string.Join("; ", result.Errors.Select(e => e.Message))}");
        }
    }

    [Fact]
    public void Structural_problems_are_reported_with_node_and_edge_ids()
    {
        var workflow = new WorkflowBuilder()
            .Node("a", "log", new { message = "hi" })
            .Node("a", "log", new { message = "dup" })
            .Node("mystery", "does.not.exist")
            .Node("check", "condition")
            .Edge("a", "ghost")
            .Edge("check", "a", "maybe")
            .Build();

        var result = Validator.Validate(workflow);

        Assert.False(result.Valid);
        Assert.Contains(result.Errors, e => e.Message.Contains("Duplicate node id 'a'") && e.NodeId == "a");
        Assert.Contains(result.Errors, e => e.Message.Contains("Unknown activity type 'does.not.exist'") && e.NodeId == "mystery");
        Assert.Contains(result.Errors, e => e.Message.Contains("'Condition' is required") && e.NodeId == "check");
        Assert.Contains(result.Errors, e => e.Message.Contains("needs a trigger"));
        Assert.Contains(result.Errors, e => e.Message.Contains("'ghost' does not exist") && e.EdgeId == "e1");
        Assert.Contains(result.Errors, e => e.Message.Contains("no outcome 'maybe'") && e.EdgeId == "e2");
    }

    [Fact]
    public void Cycles_are_only_allowed_through_a_forEach()
    {
        var plainCycle = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("a", "log", new { message = "a" })
            .Node("b", "log", new { message = "b" })
            .Edge("start", "a").Edge("a", "b").Edge("b", "a")
            .Build();

        var loop = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("each", "loop.forEach", new { items = "[1, 2]" })
            .Node("body", "log", new { message = "x" })
            .Edge("start", "each").Edge("each", "body", Outcomes.Item).Edge("body", "each")
            .Build();

        var cycleError = Assert.Single(Validator.Validate(plainCycle).Errors);
        Assert.Contains("must pass through a loop.forEach", cycleError.Message);
        Assert.True(Validator.Validate(loop).Valid);
    }

    [Fact]
    public void Switch_case_names_are_valid_outcomes()
    {
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("route", "switch", new { cases = new[] { new { name = "big", expression = "input > 1" } } })
            .Node("x", "log", new { message = "x" })
            .Edge("start", "route").Edge("route", "x", "big").Edge("route", "x", "default")
            .Build();

        Assert.True(Validator.Validate(workflow).Valid);
    }
}
