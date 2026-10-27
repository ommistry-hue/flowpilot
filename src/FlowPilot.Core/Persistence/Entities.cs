using FlowPilot.Abstractions;
using FlowPilot.Core.Contracts;

namespace FlowPilot.Core.Persistence;

// JSON payloads are stored as TEXT so the schema is identical on SQLite and PostgreSQL.

public sealed class WorkflowDefinitionEntity
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public string DraftJson { get; set; } = "{}";
    public int? PublishedVersion { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class WorkflowVersionEntity
{
    public Guid Id { get; set; }
    public Guid DefinitionId { get; set; }
    public int Version { get; set; }
    public string Json { get; set; } = "{}";
    public DateTime CreatedAt { get; set; }
}

public sealed class WorkflowRunEntity
{
    public Guid Id { get; set; }
    public Guid DefinitionId { get; set; }
    public int? Version { get; set; }
    public string DefinitionSnapshotJson { get; set; } = "{}";
    public RunStatus Status { get; set; }
    public string TriggerNodeId { get; set; } = "";
    public string? InputJson { get; set; }
    public string VariablesJson { get; set; } = "{}";
    public string NodeStateJson { get; set; } = "{}";
    public string OutputsJson { get; set; } = "{}";
    /// <summary>Tokens (failed node plus dropped branches) to replay when a failed run is retried.</summary>
    public string? RetryTokensJson { get; set; }
    public string? Error { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public Guid ConcurrencyToken { get; set; }

    public bool IsFinished => Status is RunStatus.Completed or RunStatus.Failed or RunStatus.Cancelled;
}

public sealed class NodeExecutionEntity
{
    public Guid Id { get; set; }
    public Guid RunId { get; set; }
    public string NodeId { get; set; } = "";
    public string NodeType { get; set; } = "";
    public int Attempt { get; set; }
    public NodeExecutionStatus Status { get; set; }
    public string? InputJson { get; set; }
    public string? OutputJson { get; set; }
    public string? Outcome { get; set; }
    public string? Error { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public sealed class WorkItemEntity
{
    public Guid Id { get; set; }
    public Guid RunId { get; set; }
    public string NodeId { get; set; } = "";
    public string? InputJson { get; set; }
    public string? ResumePayloadJson { get; set; }
    public int Attempt { get; set; } = 1;
    public DateTime AvailableAt { get; set; }
    public string? LockedBy { get; set; }
    public DateTime? LockedUntil { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class BookmarkEntity
{
    public Guid Id { get; set; }
    public Guid RunId { get; set; }
    public string NodeId { get; set; } = "";
    public BookmarkKind Kind { get; set; }
    public string? CorrelationKey { get; set; }
    public string? PayloadJson { get; set; }
    public DateTime? ResumeAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public string? ResolutionJson { get; set; }
}

public sealed class ScheduleStateEntity
{
    public Guid DefinitionId { get; set; }
    public string NodeId { get; set; } = "";
    public DateTime NextFireAt { get; set; }
}
