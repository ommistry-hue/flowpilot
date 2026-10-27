using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core;
using FlowPilot.Core.Activities;
using FlowPilot.Core.Engine;
using FlowPilot.Core.Services;

namespace FlowPilot.Server.Endpoints;

public sealed record RunWorkflowRequest(JsonNode? Input, string? TriggerNodeId);

public static class WorkflowEndpoints
{
    public static void MapActivityEndpoints(this IEndpointRouteBuilder app) =>
        app.MapGet("/api/activities", (ActivityRegistry registry) => registry.Descriptors);

    public static void MapWorkflowEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/workflows");

        group.MapGet("/", (WorkflowStore store, CancellationToken ct) => store.ListAsync(ct));

        group.MapPost("/", async (WorkflowDefinition definition, WorkflowStore store, CancellationToken ct) =>
        {
            var created = await store.CreateAsync(definition, ct);
            return Results.Created($"/api/workflows/{created.Id}", created);
        });

        group.MapPost("/validate", (WorkflowDefinition definition, WorkflowValidator validator) => validator.Validate(definition));

        group.MapGet("/{id:guid}", async (Guid id, WorkflowStore store, CancellationToken ct) =>
            await store.GetAsync(id, ct) is { } workflow ? Results.Ok(workflow) : Results.NotFound());

        group.MapPut("/{id:guid}", async (Guid id, WorkflowDefinition definition, WorkflowStore store, CancellationToken ct) =>
            await store.UpdateAsync(id, definition, ct) is { } workflow ? Results.Ok(workflow) : Results.NotFound());

        group.MapDelete("/{id:guid}", async (Guid id, WorkflowStore store, CancellationToken ct) =>
            await store.DeleteAsync(id, ct) ? Results.NoContent() : Results.NotFound());

        group.MapPost("/{id:guid}/publish", async (Guid id, WorkflowStore store, CancellationToken ct) =>
            await store.PublishAsync(id, ct) switch
            {
                null => Results.NotFound(),
                { Version: { } version } => Results.Ok(new { version }),
                var invalid => Results.BadRequest(invalid.Validation),
            });

        group.MapGet("/{id:guid}/versions", async (Guid id, WorkflowStore store, CancellationToken ct) =>
            await store.VersionsAsync(id, ct) is { } versions ? Results.Ok(versions) : Results.NotFound());

        group.MapPost("/{id:guid}/run", async (Guid id, RunWorkflowRequest? request, WorkflowStore store, WorkflowValidator validator, WorkflowRuntime runtime, CancellationToken ct) =>
        {
            if (await store.GetAsync(id, ct) is not { } workflow) return Results.NotFound();

            var validation = validator.Validate(workflow.Definition);
            if (!validation.Valid) return Results.BadRequest(validation);
            try
            {
                var runId = await runtime.StartAsync(id, workflow.Definition, version: null, request?.TriggerNodeId, request?.Input, ct);
                return Results.Accepted($"/api/runs/{runId}", new { runId });
            }
            catch (WorkflowRuntimeException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });
    }
}
