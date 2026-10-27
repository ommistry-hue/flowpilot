using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FlowPilot.Core;
using FlowPilot.Core.Engine;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;

namespace FlowPilot.Server.Endpoints;

public sealed record EventRequest(JsonNode? Payload, string? CorrelationKey);

public static class TriggerEndpoints
{
    // Stored in the run input and visible through the API, so credentials meant for FlowPilot itself are dropped.
    private static readonly HashSet<string> RedactedHeaders = new(StringComparer.OrdinalIgnoreCase) { "cookie", "authorization", ApiKeyMiddleware.HeaderName, WebhookRequest.SecretHeaderName };

    public static void MapTriggerEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/events/{name}", (string name, EventRequest? body, WorkflowRuntime runtime, CancellationToken ct) =>
            runtime.PublishEventAsync(name, body?.Payload, body?.CorrelationKey, ct));

        app.Map("/hooks/{**path}", async (string? path, HttpRequest request, WorkflowRuntime runtime, IOptions<FlowPilotOptions> options, CancellationToken ct) =>
        {
            var body = await ReadBodyAsync(request, options.Value.Webhooks.MaxBodyBytes, ct);
            if (body.TooLarge)
                return Results.Problem($"Webhook body exceeds {options.Value.Webhooks.MaxBodyBytes} bytes.", statusCode: StatusCodes.Status413PayloadTooLarge);

            var payload = new JsonObject
            {
                ["method"] = request.Method,
                ["headers"] = ToJson(request.Headers.Where(h => !RedactedHeaders.Contains(h.Key))),
                ["query"] = ToJson(request.Query),
                ["body"] = body.Value,
            };

            var dispatch = await runtime.TriggerWebhookAsync(new WebhookRequest(
                path ?? "", request.Method, payload, body.Raw,
                request.Headers[WebhookRequest.SecretHeaderName].FirstOrDefault(),
                request.Headers[WebhookRequest.SignatureHeaderName].FirstOrDefault()), ct);

            if (!dispatch.Matched)
                return Results.NotFound(new { error = $"No published workflow listens on {request.Method} /hooks/{path}." });
            return dispatch.RunIds.Count == 0
                ? Results.Json(new { error = $"Missing or invalid {WebhookRequest.SecretHeaderName} or {WebhookRequest.SignatureHeaderName} header." }, statusCode: StatusCodes.Status401Unauthorized)
                : Results.Accepted(value: new { runIds = dispatch.RunIds });
        });
    }

    private static JsonObject ToJson(IEnumerable<KeyValuePair<string, StringValues>> values)
    {
        var result = new JsonObject();
        foreach (var (key, value) in values) result[key.ToLowerInvariant()] = value.ToString();
        return result;
    }

    private readonly record struct WebhookBody(JsonNode? Value, byte[] Raw, bool TooLarge);

    private static async Task<WebhookBody> ReadBodyAsync(HttpRequest request, long maxBytes, CancellationToken ct)
    {
        if (request.ContentLength > maxBytes) return new(null, [], TooLarge: true);

        // Content-Length can be absent (chunked), so the limit is enforced while reading as well.
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int read;
        while ((read = await request.Body.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > maxBytes) return new(null, [], TooLarge: true);
            buffer.Write(chunk, 0, read);
        }

        var raw = buffer.ToArray();
        if (raw.Length == 0) return new(null, raw, false);
        var text = Encoding.UTF8.GetString(raw);

        if (request.ContentType?.StartsWith("application/x-www-form-urlencoded", StringComparison.OrdinalIgnoreCase) == true)
            return new(ToJson(QueryHelpers.ParseQuery(text)), raw, false);

        try
        {
            return new(JsonNode.Parse(text), raw, false);
        }
        catch (JsonException)
        {
            return new(JsonValue.Create(text), raw, false);
        }
    }
}
