using FlowPilot.Abstractions;
using FlowPilot.Core.AI;

namespace FlowPilot.Server.Endpoints;

public sealed record GenerateRequest(string Prompt, WorkflowDefinition? Current);

public static class AiEndpoints
{
    public static void MapAiEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/ai/status", (ILlmClient llm) => new { enabled = llm.Enabled, provider = llm.Provider, model = llm.Model });

        app.MapPost("/api/ai/generate", async (GenerateRequest request, ILlmClient llm, WorkflowGenerator generator, CancellationToken ct) =>
        {
            if (!llm.Enabled) return Results.BadRequest(new { error = "AI is not configured on this server." });
            if (string.IsNullOrWhiteSpace(request.Prompt)) return Results.BadRequest(new { error = "A prompt is required." });

            try
            {
                var result = await generator.GenerateAsync(request.Prompt, request.Current, ct);
                return Results.Ok(new { definition = result.Definition, explanation = result.Explanation });
            }
            catch (LlmTimeoutException ex)
            {
                return Results.Problem(ex.Message, statusCode: StatusCodes.Status504GatewayTimeout, title: "The AI provider timed out");
            }
            catch (Exception ex) when (ex is LlmException or HttpRequestException)
            {
                return Results.Problem(ex.Message, statusCode: StatusCodes.Status502BadGateway, title: "The AI provider failed");
            }
        });
    }
}
