using System.Globalization;
using System.Text.Json.Nodes;
using FlowPilot.Abstractions;

namespace FlowPilot.Core.Activities;

// Suspending activities run twice: the first entry creates a bookmark, the resume entry
// (ResumePayload != null) completes the node.

[Activity("delay", DisplayName = "Delay", Category = "Timing", Icon = "timer",
    Description = "Pauses the branch for a duration or until a point in time. Passes its input through.")]
public sealed class DelayActivity(TimeProvider clock) : IActivity
{
    [Input(DisplayName = "Duration (ms)", Kind = InputKind.Number, Description = "Milliseconds to wait.")]
    public long? DurationMs { get; set; }

    [Input(DisplayName = "Until", Description = "ISO 8601 timestamp to wait until (used when durationMs is empty).")]
    public string? Until { get; set; }

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        if (context.ResumePayload is not null)
            return Task.FromResult(ActivityResult.Done(context.Input.Clone()));

        DateTimeOffset resumeAt;
        if (DurationMs is { } ms)
            resumeAt = clock.GetUtcNow().AddMilliseconds(Math.Max(0, ms));
        else if (DateTimeOffset.TryParse(Until, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var until))
            resumeAt = until;
        else
            return Task.FromResult(ActivityResult.Fail("Set either 'durationMs' or a valid ISO 'until' timestamp."));

        return Task.FromResult(ActivityResult.Suspend(new BookmarkRequest(BookmarkKind.Delay, ResumeAt: resumeAt,
            Payload: new JsonObject { ["resumeAt"] = resumeAt.UtcDateTime })));
    }
}

[Activity("approval", DisplayName = "Approval", Category = "Human", Icon = "user-check",
    Outcomes = [Outcomes.Approved, Outcomes.Rejected],
    Description = "Waits for a person to approve or reject. Output: { approved, comment, data }.")]
public sealed class ApprovalActivity : IActivity
{
    [Input(DisplayName = "Title", Required = true)]
    public string Title { get; set; } = "";

    [Input(DisplayName = "Description", Kind = InputKind.Multiline)]
    public string? Description { get; set; }

    [Input(DisplayName = "Assignee", Description = "Who should decide (informational).")]
    public string? Assignee { get; set; }

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        if (context.ResumePayload is JsonObject decision)
        {
            var approved = decision["approved"]?.GetValue<bool>() == true;
            return Task.FromResult(ActivityResult.WithOutcome(approved ? Outcomes.Approved : Outcomes.Rejected, decision.DeepClone()));
        }

        return Task.FromResult(ActivityResult.Suspend(new BookmarkRequest(BookmarkKind.Approval, Payload: new JsonObject
        {
            ["title"] = Title,
            ["description"] = Description,
            ["assignee"] = Assignee,
        })));
    }
}

[Activity("wait.event", DisplayName = "Wait for event", Category = "Timing", Icon = "bell",
    Description = "Pauses until POST /api/events/{event} arrives with a matching correlationKey. Output: the event payload.")]
public sealed class WaitEventActivity : IActivity
{
    [Input(DisplayName = "Event name", Required = true)]
    public string Event { get; set; } = "";

    [Input(DisplayName = "Correlation key", Description = "Only events with this key resume the branch, e.g. {{ input.orderId }}. Empty matches any.")]
    public string? CorrelationKey { get; set; }

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        if (context.ResumePayload is not null)
            return Task.FromResult(ActivityResult.Done(context.ResumePayload["payload"].Clone()));

        return Task.FromResult(ActivityResult.Suspend(new BookmarkRequest(BookmarkKind.Event,
            CorrelationKey: string.IsNullOrEmpty(CorrelationKey) ? null : CorrelationKey,
            Payload: new JsonObject { ["event"] = Event })));
    }
}
