using System.Text.Json;
using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core;

namespace FlowPilot.Tests.Infrastructure;

/// <summary>Terse workflow construction for tests: <c>new WorkflowBuilder().Node(...).Edge(...).Build()</c>.</summary>
public sealed class WorkflowBuilder(string name = "Test workflow")
{
    private readonly WorkflowDefinition _definition = new() { Id = Guid.NewGuid(), Name = name };

    public WorkflowBuilder Node(string id, string type, object? config = null, RetryPolicy? retry = null)
    {
        _definition.Nodes.Add(new NodeDefinition
        {
            Id = id,
            Type = type,
            Config = config is null ? [] : (JsonObject)JsonSerializer.SerializeToNode(config, FlowPilotJson.Options)!,
            Retry = retry,
        });
        return this;
    }

    public WorkflowBuilder Edge(string source, string target, string handle = Outcomes.Done)
    {
        _definition.Edges.Add(new EdgeDefinition { Id = $"e{_definition.Edges.Count + 1}", Source = source, SourceHandle = handle, Target = target });
        return this;
    }

    public WorkflowBuilder Variables(object variables)
    {
        _definition.Variables = (JsonObject)JsonSerializer.SerializeToNode(variables, FlowPilotJson.Options)!;
        return this;
    }

    public WorkflowDefinition Build() => _definition;
}
