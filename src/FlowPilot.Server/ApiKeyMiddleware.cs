using System.Security.Cryptography;
using System.Text;
using FlowPilot.Core;
using Microsoft.Extensions.Options;

namespace FlowPilot.Server;

/// <summary>When FlowPilot:ApiKey is set, /api and /hubs require it. Webhooks and /health stay open.</summary>
public sealed class ApiKeyMiddleware(RequestDelegate next, IOptions<FlowPilotOptions> options)
{
    public const string HeaderName = "X-Api-Key";

    public Task InvokeAsync(HttpContext context)
    {
        var apiKey = options.Value.ApiKey;
        if (string.IsNullOrEmpty(apiKey) || HttpMethods.IsOptions(context.Request.Method) || !IsProtected(context.Request.Path))
            return next(context);

        if (ProvidedKey(context.Request) is { } provided && FixedTimeEquals(provided, apiKey))
            return next(context);

        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return context.Response.WriteAsJsonAsync(new { error = $"Missing or invalid {HeaderName} header." });
    }

    // The SignalR client sends its access token as a Bearer header on HTTP requests,
    // and as access_token in the query string for WebSockets, where browsers can't set headers.
    private static string? ProvidedKey(HttpRequest request)
    {
        if (request.Headers[HeaderName].FirstOrDefault() is { } header)
            return header;
        var authorization = request.Headers.Authorization.FirstOrDefault();
        if (authorization is not null && authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return authorization["Bearer ".Length..].Trim();
        return request.Query["access_token"].FirstOrDefault();
    }

    private static bool IsProtected(PathString path) =>
        path.StartsWithSegments("/api") || path.StartsWithSegments("/hubs");

    // Hashing first gives equal-length inputs, so neither the content nor the length of the key leaks through timing.
    private static bool FixedTimeEquals(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(a)), SHA256.HashData(Encoding.UTF8.GetBytes(b)));
}
