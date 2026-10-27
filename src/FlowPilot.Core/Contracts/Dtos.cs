using System.Text.Json.Nodes;
using FlowPilot.Abstractions;

namespace FlowPilot.Core.Contracts;

public enum RunStatus { Pending, Running, Suspended, Completed, Failed, Cancelled }

public enum NodeExecutionStatus { Running, Completed, Failed, Suspended, Cancelled }

public sealed record ActivityDescriptor(
    string Type,
    string DisplayName,
    string Category,
    string? Description,
    string? Icon,
    string[] Outcomes,
    bool DynamicOutcomes,
    bool IsTrigger,
    IReadOnlyList<ActivityInputDescriptor> Inputs);

public sealed record ActivityInputDescriptor(
    string Name,
    string DisplayName,
    string? Description,
    InputKind Kind,
    string[]? Options,
    bool Required,
    object? DefaultValue);

public record WorkflowSummary
{
    public Guid Id { get; init; }
    public string Name { get; init; } = "";
    public string? Description { get; init; }
    public int? PublishedVersion { get; init; }
    public DateTime UpdatedAt { get; init; }
    public DateTime CreatedAt { get; init; }
    public string[] TriggerTypes { get; init; } = [];
    public int NodeCount { get; init; }
}

public sealed record WorkflowDetail : WorkflowSummary
{
    public WorkflowDetail(WorkflowSummary summary, WorkflowDefinition definition) : base(summary) => Definition = definition;

    public WorkflowDefinition Definition { get; init; }
}

public sealed record WorkflowVersionDto(int Version, DateTime CreatedAt);

public sealed record ValidationError(string Message, string? NodeId = null, string? EdgeId = null);

public sealed record ValidationResult(bool Valid, IReadOnlyList<ValidationError> Errors);

public record RunSummary
{
    public Guid Id { get; init; }
    public Guid WorkflowId { get; init; }
    public string WorkflowName { get; init; } = "";
    public int? Version { get; init; }
    public RunStatus Status { get; init; }
    public string TriggerNodeId { get; init; } = "";
    public DateTime CreatedAt { get; init; }
    public DateTime? StartedAt { get; init; }
    public DateTime? CompletedAt { get; init; }
    public long? DurationMs { get; init; }
    public string? Error { get; init; }
}

public sealed record RunDetail : RunSummary
{
    public RunDetail(RunSummary summary, WorkflowDefinition definition) : base(summary) => Definition = definition;

    public WorkflowDefinition Definition { get; init; }
    public JsonNode? Input { get; init; }
    public JsonObject Variables { get; init; } = [];
    public IReadOnlyList<NodeExecutionDto> Nodes { get; init; } = [];
    public IReadOnlyList<BookmarkDto> Bookmarks { get; init; } = [];
}

public sealed record NodeExecutionDto(
    Guid Id,
    Guid RunId,
    string NodeId,
    string NodeType,
    int Attempt,
    NodeExecutionStatus Status,
    JsonNode? Input,
    JsonNode? Output,
    string? Outcome,
    string? Error,
    DateTime StartedAt,
    DateTime? CompletedAt,
    long? DurationMs);

public sealed record BookmarkDto(
    Guid Id,
    string NodeId,
    BookmarkKind Kind,
    string? CorrelationKey,
    JsonNode? Payload,
    DateTime? ResumeAt,
    DateTime CreatedAt,
    DateTime? ResolvedAt,
    JsonNode? Resolution);

public sealed record ApprovalDto(
    Guid Id,
    Guid RunId,
    Guid WorkflowId,
    string WorkflowName,
    string NodeId,
    string? Title,
    string? Description,
    string? Assignee,
    DateTime CreatedAt,
    DateTime? ResolvedAt,
    JsonNode? Resolution);

public sealed record RunsPage(IReadOnlyList<RunSummary> Items, int Total);

public sealed record DailyRunCount(string Date, int Completed, int Failed);

public sealed record StatsDto(int Workflows, int Runs24h, int Failed24h, int PendingApprovals, IReadOnlyList<DailyRunCount> RunsByDay);

public sealed record EventDispatchResult(IReadOnlyList<Guid> StartedRuns, int Resumed);
