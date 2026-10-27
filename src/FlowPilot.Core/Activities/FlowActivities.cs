using System.Text.Json.Nodes;
using FlowPilot.Abstractions;

namespace FlowPilot.Core.Activities;

[Activity("condition", DisplayName = "Condition", Category = "Flow", Icon = "git-branch",
    Outcomes = [Outcomes.True, Outcomes.False],
    Description = "Evaluates a JS expression and follows 'true' or 'false'. Passes its input through.")]
public sealed class ConditionActivity : IActivity
{
    [Input(DisplayName = "Condition", Kind = InputKind.Expression, Required = true, Description = "e.g. input.body.total > 100")]
    public string Expression { get; set; } = "";

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        var outcome = FlowPilotJson.IsTruthy(context.Expressions.Evaluate(Expression)) ? Outcomes.True : Outcomes.False;
        return Task.FromResult(ActivityResult.WithOutcome(outcome, context.Input.Clone()));
    }
}

[Activity("switch", DisplayName = "Switch", Category = "Flow", Icon = "split", DynamicOutcomes = true,
    Outcomes = [SwitchActivity.DefaultOutcome],
    Description = "Follows the first case whose expression is truthy, otherwise 'default'. Passes its input through.")]
public sealed class SwitchActivity : IActivity
{
    public const string DefaultOutcome = "default";

    [Input(DisplayName = "Cases", Kind = InputKind.Json, Required = true, Description = "[{ \"name\": \"big\", \"expression\": \"input.total > 100\" }]")]
    public JsonArray Cases { get; set; } = [];

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        foreach (var @case in Cases.OfType<JsonObject>())
        {
            var name = @case["name"]?.GetValue<string>();
            var expression = @case["expression"]?.GetValue<string>();
            if (string.IsNullOrEmpty(name) || string.IsNullOrWhiteSpace(expression)) continue;
            if (FlowPilotJson.IsTruthy(context.Expressions.Evaluate(expression)))
                return Task.FromResult(ActivityResult.WithOutcome(name, context.Input.Clone()));
        }
        return Task.FromResult(ActivityResult.WithOutcome(DefaultOutcome, context.Input.Clone()));
    }
}

/// <summary>
/// Loops are explicit cycles: 'item' leads into the body, whose last node connects back here.
/// Each re-entry advances the index kept in NodeState; when the items run out, 'done' fires and the state resets.
/// </summary>
[Activity("loop.forEach", DisplayName = "For each", Category = "Flow", Icon = "repeat",
    Outcomes = [Outcomes.Item, Outcomes.Done],
    Description = "Emits 'item' once per element ({ item, index }); connect the body's last node back to this node. Emits 'done' at the end.")]
public sealed class ForEachActivity : IActivity
{
    [Input(DisplayName = "Items", Kind = InputKind.Expression, Required = true, Description = "JS expression returning an array, e.g. input.body.items")]
    public string Items { get; set; } = "";

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        var state = context.NodeState;
        int index;
        if (state["items"] is JsonArray)
        {
            index = state["index"]!.GetValue<int>() + 1;
        }
        else
        {
            var evaluated = context.Expressions.Evaluate(Items);
            if (evaluated is not (null or JsonArray))
                return Task.FromResult(ActivityResult.Fail($"'items' must evaluate to an array, got {evaluated.GetValueKind()}."));
            state["items"] = evaluated ?? new JsonArray();
            index = 0;
        }

        var items = (JsonArray)state["items"]!;
        if (index >= items.Count)
        {
            var output = new JsonObject { ["count"] = items.Count, ["items"] = items.DeepClone() };
            state.Clear();
            return Task.FromResult(ActivityResult.WithOutcome(Outcomes.Done, output));
        }

        state["index"] = index;
        return Task.FromResult(ActivityResult.WithOutcome(Outcomes.Item, new JsonObject
        {
            ["item"] = items[index].Clone(),
            ["index"] = index,
        }));
    }
}

[Activity("flow.parallel", DisplayName = "Parallel", Category = "Flow", Icon = "git-fork",
    Description = "Pass-through. Draw several edges from 'done' to run branches in parallel.")]
public sealed class ParallelActivity : IActivity
{
    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken) =>
        Task.FromResult(ActivityResult.Done(context.Input.Clone()));
}

/// <summary>The engine collects arrivals in this node's state and only schedules it once the join condition holds.</summary>
[Activity("flow.join", DisplayName = "Join", Category = "Flow", Icon = "merge",
    Description = "Waits for every incoming branch (all) or the first one (any). Output: { <sourceNodeId>: output }.")]
public sealed class JoinActivity : IActivity
{
    public const string ModeAll = "all";
    public const string ModeAny = "any";

    [Input(DisplayName = "Mode", Kind = InputKind.Select, Options = [ModeAll, ModeAny], DefaultValue = ModeAll)]
    public string Mode { get; set; } = ModeAll;

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken) =>
        Task.FromResult(ActivityResult.Done(context.Input.Clone()));
}
