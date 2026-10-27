using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using Microsoft.Extensions.Options;

namespace FlowPilot.Core.Activities;

[Activity("http.request", DisplayName = "HTTP request", Category = "Integrations", Icon = "globe",
    Description = "Calls an HTTP endpoint. Output: { status, headers, body }. Non-2xx responses fail the node.")]
public sealed class HttpRequestActivity(IHttpClientFactory httpClientFactory, IOptions<FlowPilotOptions> options) : IActivity
{
    public const string HttpClientName = "FlowPilot.Http";

    [Input(DisplayName = "URL", Required = true)]
    public string Url { get; set; } = "";

    [Input(DisplayName = "Method", Kind = InputKind.Select, Options = ["GET", "POST", "PUT", "PATCH", "DELETE"], DefaultValue = "GET")]
    public string Method { get; set; } = "GET";

    [Input(DisplayName = "Headers", Kind = InputKind.Json, Description = "{ \"Authorization\": \"Bearer ...\" }")]
    public JsonObject? Headers { get; set; }

    [Input(DisplayName = "Body", Kind = InputKind.Multiline, Description = "Objects and arrays are sent as JSON, strings as-is.")]
    public JsonNode? Body { get; set; }

    [Input(DisplayName = "Timeout (ms)", Kind = InputKind.Number, DefaultValue = 30000)]
    public int? TimeoutMs { get; set; }

    public async Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(new HttpMethod(Method.ToUpperInvariant()), Url);
        request.Content = CreateContent(Body);

        foreach (var (name, value) in Headers ?? [])
        {
            var headerValue = FlowPilotJson.AsText(value);
            if (!request.Headers.TryAddWithoutValidation(name, headerValue) && request.Content is not null)
            {
                request.Content.Headers.Remove(name);
                request.Content.Headers.TryAddWithoutValidation(name, headerValue);
            }
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMilliseconds(TimeoutMs ?? 30_000));

        var maxBytes = options.Value.Http.MaxResponseBytes;
        HttpResponseMessage response;
        string text;
        try
        {
            response = await httpClientFactory.CreateClient(HttpClientName)
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            text = await ReadLimitedAsync(response, maxBytes, timeout.Token) ?? "";
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return ActivityResult.Fail($"Request to {Url} timed out after {TimeoutMs ?? 30_000} ms.");
        }
        catch (HttpRequestException ex)
        {
            return ActivityResult.Fail($"Request to {Url} failed: {ex.Message}");
        }
        catch (ResponseTooLargeException)
        {
            return ActivityResult.Fail($"Response from {Url} is larger than {maxBytes} bytes (FlowPilot:Http:MaxResponseBytes).");
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
                return ActivityResult.Fail($"{(int)response.StatusCode} {response.ReasonPhrase}: {Truncate(text, 500)}");

            var headers = new JsonObject();
            foreach (var (name, values) in response.Headers.Concat(response.Content.Headers))
                headers[name.ToLowerInvariant()] = string.Join(", ", values);

            return ActivityResult.Done(new JsonObject
            {
                ["status"] = (int)response.StatusCode,
                ["headers"] = headers,
                ["body"] = ParseBody(text, response.Content.Headers.ContentType),
            });
        }
    }

    private sealed class ResponseTooLargeException : Exception;

    private static async Task<string?> ReadLimitedAsync(HttpResponseMessage response, long maxBytes, CancellationToken ct)
    {
        if (response.Content.Headers.ContentLength > maxBytes)
        {
            response.Dispose();
            throw new ResponseTooLargeException();
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > maxBytes)
            {
                response.Dispose();
                throw new ResponseTooLargeException();
            }
            buffer.Write(chunk, 0, read);
        }

        var charset = response.Content.Headers.ContentType?.CharSet;
        var encoding = Encoding.UTF8;
        try { if (!string.IsNullOrEmpty(charset)) encoding = Encoding.GetEncoding(charset.Trim('"')); }
        catch (ArgumentException) { }
        return encoding.GetString(buffer.GetBuffer(), 0, (int)buffer.Length);
    }

    private static HttpContent? CreateContent(JsonNode? body) => body switch
    {
        null => null,
        JsonValue v when v.TryGetValue<string>(out var s) => new StringContent(s, Encoding.UTF8, LooksLikeJson(s) ? "application/json" : "text/plain"),
        _ => new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"),
    };

    private static JsonNode? ParseBody(string text, MediaTypeHeaderValue? contentType)
    {
        if (text.Length == 0) return null;
        if (contentType?.MediaType?.Contains("json", StringComparison.OrdinalIgnoreCase) == true || LooksLikeJson(text))
        {
            try { return JsonNode.Parse(text); }
            catch (JsonException) { }
        }
        return JsonValue.Create(text);
    }

    private static bool LooksLikeJson(string text)
    {
        var trimmed = text.TrimStart();
        return trimmed.StartsWith('{') || trimmed.StartsWith('[');
    }

    private static string Truncate(string text, int max) => text.Length <= max ? text : text[..max] + "…";
}
