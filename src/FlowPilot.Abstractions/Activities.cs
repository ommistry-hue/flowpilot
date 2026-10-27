using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;

namespace FlowPilot.Abstractions;

/// <summary>A unit of work in a workflow. A new instance is created per execution; [Input] properties are bound from the node config.</summary>
public interface IActivity
{
    Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken);
}

[AttributeUsage(AttributeTargets.Class, Inherited = false)]
public sealed class ActivityAttribute(string type) : Attribute
{
    public string Type { get; } = type;
    public string? DisplayName { get; set; }
    public string Category { get; set; } = "General";
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public string[] Outcomes { get; set; } = [Abstractions.Outcomes.Done];
    /// <summary>True when outcomes are computed from config (e.g. switch cases). The designer reads them from config.</summary>
    public bool DynamicOutcomes { get; set; }
    public bool IsTrigger { get; set; }
}

public enum InputKind { Text, Multiline, Expression, Number, Boolean, Json, Select, Code }

[AttributeUsage(AttributeTargets.Property, Inherited = true)]
public sealed class InputAttribute : Attribute
{
    public string? DisplayName { get; set; }
    public string? Description { get; set; }
    public InputKind Kind { get; set; } = InputKind.Text;
    public string[]? Options { get; set; }
    public bool Required { get; set; }
    public object? DefaultValue { get; set; }
}

public static class Outcomes
{
    public const string Done = "done";
    public const string True = "true";
    public const string False = "false";
    public const string Error = "error";
    public const string Item = "item";
    public const string Approved = "approved";
    public const string Rejected = "rejected";
}

public sealed class ActivityContext
{
    public required Guid RunId { get; init; }
    public required string NodeId { get; init; }
    public required int Attempt { get; init; }
    /// <summary>Node config after {{ expression }} evaluation.</summary>
    public required JsonObject Config { get; init; }
    /// <summary>Output of the node that led here (or trigger payload for trigger nodes).</summary>
    public JsonNode? Input { get; init; }
    /// <summary>Run variables. Changes are persisted after the activity completes.</summary>
    public required JsonObject Variables { get; init; }
    /// <summary>Per-node state that survives re-entry (loops) and suspension.</summary>
    public required JsonObject NodeState { get; init; }
    /// <summary>Payload supplied when a suspended node is resumed (approval decision, event data); null on first entry.</summary>
    public JsonNode? ResumePayload { get; init; }
    public required IServiceProvider Services { get; init; }
    public required ILogger Logger { get; init; }
    public required IExpressionEvaluator Expressions { get; init; }
}

public interface IExpressionEvaluator
{
    /// <summary>Evaluates a raw JS expression (no braces) in the current run scope.</summary>
    JsonNode? Evaluate(string expression, IReadOnlyDictionary<string, JsonNode?>? extraScope = null);
}

public enum BookmarkKind { Approval, Delay, Event }

public sealed record BookmarkRequest(
    BookmarkKind Kind,
    DateTimeOffset? ResumeAt = null,
    string? CorrelationKey = null,
    JsonNode? Payload = null);

public sealed record ActivityResult
{
    public ActivityStatus Status { get; private init; }
    public string Outcome { get; private init; } = Outcomes.Done;
    public JsonNode? Output { get; private init; }
    public string? Error { get; private init; }
    public BookmarkRequest? Bookmark { get; private init; }

    public static ActivityResult Done(JsonNode? output = null) => new() { Status = ActivityStatus.Completed, Output = output };
    public static ActivityResult WithOutcome(string outcome, JsonNode? output = null) => new() { Status = ActivityStatus.Completed, Outcome = outcome, Output = output };
    public static ActivityResult Suspend(BookmarkRequest bookmark) => new() { Status = ActivityStatus.Suspended, Bookmark = bookmark };
    public static ActivityResult Fail(string error) => new() { Status = ActivityStatus.Failed, Error = error, Outcome = Outcomes.Error };
}

public enum ActivityStatus { Completed, Suspended, Failed }
