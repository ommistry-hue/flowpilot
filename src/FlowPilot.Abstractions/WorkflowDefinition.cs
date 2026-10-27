using System.Text.Json.Nodes;

namespace FlowPilot.Abstractions;

/// <summary>Serialized with camelCase JSON. See docs/SPEC.md.</summary>
public sealed class WorkflowDefinition
{
    public string SchemaVersion { get; set; } = "1";
    public Guid Id { get; set; }
    public string Name { get; set; } = "Untitled workflow";
    public string? Description { get; set; }
    public JsonObject Variables { get; set; } = [];
    public List<NodeDefinition> Nodes { get; set; } = [];
    public List<EdgeDefinition> Edges { get; set; } = [];
}

public sealed class NodeDefinition
{
    public string Id { get; set; } = "";
    public string Type { get; set; } = "";
    public string? Name { get; set; }
    public JsonObject Config { get; set; } = [];
    public RetryPolicy? Retry { get; set; }
    public int? TimeoutMs { get; set; }
    public Position Position { get; set; } = new();
}

public sealed class EdgeDefinition
{
    public string Id { get; set; } = "";
    public string Source { get; set; } = "";
    public string SourceHandle { get; set; } = Outcomes.Done;
    public string Target { get; set; } = "";
}

public sealed class Position
{
    public double X { get; set; }
    public double Y { get; set; }
}

public sealed class RetryPolicy
{
    public int MaxAttempts { get; set; } = 3;
    public int InitialDelayMs { get; set; } = 1000;
    public double BackoffMultiplier { get; set; } = 2;
    public int MaxDelayMs { get; set; } = 60_000;
}
