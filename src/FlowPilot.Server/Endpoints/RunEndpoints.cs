using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core.Contracts;
using FlowPilot.Core.Engine;
using FlowPilot.Core.Services;

namespace FlowPilot.Server.Endpoints;

public sealed record ApprovalDecisionRequest(string? Comment, JsonNode? Data);

public static class RunEndpoints
{
    public static void MapRunEndpoints(this IEndpointRouteBuilder app)
    {
        var runs = app.MapGroup("/api/runs");

        runs.MapGet("/", (Guid? workflowId, RunStatus? status, int? skip, int? take, RunQueries queries, CancellationToken ct) =>
            queries.ListAsync(workflowId, status, skip ?? 0, take ?? 50, ct));

        runs.MapGet("/{id:guid}", async (Guid id, RunQueries queries, CancellationToken ct) =>
            await queries.GetAsync(id, ct) is { } run ? Results.Ok(run) : Results.NotFound());

        runs.MapPost("/{id:guid}/cancel", async (Guid id, WorkflowRuntime runtime, CancellationToken ct) =>
            await runtime.CancelAsync(id, ct) ? Results.NoContent() : Results.Conflict(new { error = "Run not found or already finished." }));

        runs.MapPost("/{id:guid}/retry", async (Guid id, WorkflowRuntime runtime, CancellationToken ct) =>
            await runtime.RetryAsync(id, ct) ? Results.NoContent() : Results.Conflict(new { error = "Only failed runs can be retried." }));

        var approvals = app.MapGroup("/api/approvals");

        approvals.MapGet("/", (string? status, RunQueries queries, CancellationToken ct) =>
            queries.ApprovalsAsync(pending: !string.Equals(status, "resolved", StringComparison.OrdinalIgnoreCase), ct));

        approvals.MapPost("/{bookmarkId:guid}/approve", (Guid bookmarkId, ApprovalDecisionRequest? body, WorkflowRuntime runtime, CancellationToken ct) =>
            DecideAsync(bookmarkId, approved: true, body, runtime, ct));

        approvals.MapPost("/{bookmarkId:guid}/reject", (Guid bookmarkId, ApprovalDecisionRequest? body, WorkflowRuntime runtime, CancellationToken ct) =>
            DecideAsync(bookmarkId, approved: false, body, runtime, ct));

        app.MapGet("/api/stats", (RunQueries queries, CancellationToken ct) => queries.StatsAsync(ct));
    }

    private static async Task<IResult> DecideAsync(Guid bookmarkId, bool approved, ApprovalDecisionRequest? body, WorkflowRuntime runtime, CancellationToken ct)
    {
        var resolution = new JsonObject
        {
            ["approved"] = approved,
            ["comment"] = body?.Comment,
            ["data"] = approved ? body?.Data?.DeepClone() : null,
            ["decidedAt"] = DateTime.UtcNow,
        };
        return await runtime.ResumeAsync(bookmarkId, resolution, BookmarkKind.Approval, ct)
            ? Results.NoContent()
            : Results.NotFound(new { error = "No pending approval with this id." });
    }
}
