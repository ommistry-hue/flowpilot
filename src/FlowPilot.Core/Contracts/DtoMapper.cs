using FlowPilot.Abstractions;
using FlowPilot.Core.Persistence;

namespace FlowPilot.Core.Contracts;

public static class DtoMapper
{
    public static WorkflowSummary ToSummary(WorkflowDefinitionEntity entity, WorkflowDefinition definition) => new()
    {
        Id = entity.Id,
        Name = entity.Name,
        Description = entity.Description,
        PublishedVersion = entity.PublishedVersion,
        CreatedAt = entity.CreatedAt,
        UpdatedAt = entity.UpdatedAt,
        TriggerTypes = definition.Nodes.Where(n => n.Type.StartsWith("trigger.", StringComparison.Ordinal)).Select(n => n.Type).Distinct().ToArray(),
        NodeCount = definition.Nodes.Count,
    };

    public static WorkflowDetail ToDetail(WorkflowDefinitionEntity entity, WorkflowDefinition definition) =>
        new(ToSummary(entity, definition), definition);

    public static RunSummary ToSummary(WorkflowRunEntity run, string workflowName) => new()
    {
        Id = run.Id,
        WorkflowId = run.DefinitionId,
        WorkflowName = workflowName,
        Version = run.Version,
        Status = run.Status,
        TriggerNodeId = run.TriggerNodeId,
        CreatedAt = run.CreatedAt,
        StartedAt = run.StartedAt,
        CompletedAt = run.CompletedAt,
        DurationMs = Duration(run.StartedAt, run.CompletedAt),
        Error = run.Error,
    };

    public static RunDetail ToDetail(WorkflowRunEntity run, IEnumerable<NodeExecutionEntity> executions, IEnumerable<BookmarkEntity> bookmarks)
    {
        var definition = FlowPilotJson.ParseDefinition(run.DefinitionSnapshotJson);
        return new RunDetail(ToSummary(run, definition.Name), definition)
        {
            Input = FlowPilotJson.ParseNode(run.InputJson),
            Variables = FlowPilotJson.ParseObject(run.VariablesJson),
            Nodes = executions.Select(ToDto).ToList(),
            Bookmarks = bookmarks.Select(ToDto).ToList(),
        };
    }

    public static NodeExecutionDto ToDto(NodeExecutionEntity e) => new(
        e.Id, e.RunId, e.NodeId, e.NodeType, e.Attempt, e.Status,
        FlowPilotJson.ParseNode(e.InputJson), FlowPilotJson.ParseNode(e.OutputJson),
        e.Outcome, e.Error, e.StartedAt, e.CompletedAt, Duration(e.StartedAt, e.CompletedAt));

    public static BookmarkDto ToDto(BookmarkEntity b) => new(
        b.Id, b.NodeId, b.Kind, b.CorrelationKey, FlowPilotJson.ParseNode(b.PayloadJson),
        b.ResumeAt, b.CreatedAt, b.ResolvedAt, FlowPilotJson.ParseNode(b.ResolutionJson));

    private static long? Duration(DateTime? start, DateTime? end) =>
        start is { } s && end is { } e ? (long)(e - s).TotalMilliseconds : null;
}
