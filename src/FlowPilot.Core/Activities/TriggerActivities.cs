using System.Text.Json.Nodes;
using FlowPilot.Abstractions;

namespace FlowPilot.Core.Activities;

/// <summary>Triggers just hand the trigger payload to the next node; starting runs is the runtime's job.</summary>
public abstract class TriggerActivity : IActivity
{
    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken) =>
        Task.FromResult(ActivityResult.Done(context.Input.Clone()));
}

[Activity("trigger.manual", DisplayName = "Manual trigger", Category = "Triggers", Icon = "play", IsTrigger = true,
    Description = "Started from the UI or POST /api/workflows/{id}/run.")]
public sealed class ManualTriggerActivity : TriggerActivity
{
    [Input(DisplayName = "Input schema", Kind = InputKind.Json, Description = "Optional JSON schema describing the expected input.")]
    public JsonNode? InputSchema { get; set; }
}

[Activity("trigger.webhook", DisplayName = "Webhook", Category = "Triggers", Icon = "webhook", IsTrigger = true,
    Description = "Starts the published workflow when /hooks/{path} is called. Output: { method, headers, query, body }.")]
public sealed class WebhookTriggerActivity : TriggerActivity
{
    [Input(DisplayName = "Path", Required = true, Description = "Path below /hooks/, e.g. 'orders'.")]
    public string Path { get; set; } = "";

    [Input(DisplayName = "HTTP method", Kind = InputKind.Select, Options = ["POST", "GET", "PUT", "ANY"], DefaultValue = "POST")]
    public string Method { get; set; } = "POST";

    [Input(DisplayName = "Shared secret", Description = "Optional. Callers must send it in X-FlowPilot-Secret, or sign the body with it (X-Hub-Signature-256). Use {{ secrets.NAME }} to keep it out of the workflow.")]
    public string? Secret { get; set; }
}

[Activity("trigger.cron", DisplayName = "Schedule", Category = "Triggers", Icon = "clock", IsTrigger = true,
    Description = "Runs the published workflow on a cron schedule (seconds field optional). Output: { firedAt }.")]
public sealed class CronTriggerActivity : TriggerActivity
{
    [Input(DisplayName = "Cron expression", Required = true, Description = "e.g. '*/5 * * * *'; a sixth leading field adds seconds.")]
    public string Cron { get; set; } = "";

    [Input(DisplayName = "Time zone", Description = "IANA or Windows time zone id. Defaults to UTC.")]
    public string? Timezone { get; set; }
}

[Activity("trigger.event", DisplayName = "Event", Category = "Triggers", Icon = "zap", IsTrigger = true,
    Description = "Starts the published workflow when POST /api/events/{event} is called. Output: the event payload.")]
public sealed class EventTriggerActivity : TriggerActivity
{
    [Input(DisplayName = "Event name", Required = true)]
    public string Event { get; set; } = "";
}
