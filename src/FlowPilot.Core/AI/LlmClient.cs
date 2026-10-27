using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace FlowPilot.Core.AI;

public sealed record LlmRequest(string Prompt, string? System = null, string? Model = null, int MaxTokens = 16_000);

public class LlmException(string message) : Exception(message);

/// <summary>The provider did not answer within the client timeout.</summary>
public sealed class LlmTimeoutException(string message) : LlmException(message);

public interface ILlmClient
{
    bool Enabled { get; }
    string Provider { get; }
    string Model { get; }
    Task<string> CompleteAsync(LlmRequest request, CancellationToken cancellationToken);
}

/// <summary>Minimal client for the Anthropic Messages API and OpenAI-compatible chat completions, over plain HttpClient.</summary>
public sealed class LlmClient(IHttpClientFactory httpClientFactory, IOptions<FlowPilotOptions> options) : ILlmClient
{
    public const string HttpClientName = "FlowPilot.Llm";

    private AiOptions Settings => options.Value.AI;

    public bool Enabled => Settings.Enabled;
    public string Provider => Settings.IsOpenAi ? "openai" : "anthropic";
    public string Model => Settings.Model;

    public Task<string> CompleteAsync(LlmRequest request, CancellationToken cancellationToken)
    {
        if (!Enabled) throw new LlmException("AI is not configured. Set FlowPilot:AI:ApiKey (and optionally Provider, Model, BaseUrl).");
        return Settings.IsOpenAi ? CompleteOpenAiAsync(request, cancellationToken) : CompleteAnthropicAsync(request, cancellationToken);
    }

    private async Task<string> CompleteAnthropicAsync(LlmRequest request, CancellationToken cancellationToken)
    {
        var baseUrl = (Settings.BaseUrl ?? "https://api.anthropic.com").TrimEnd('/');
        var body = new JsonObject
        {
            ["model"] = request.Model ?? Settings.Model,
            ["max_tokens"] = request.MaxTokens,
            ["messages"] = new JsonArray(new JsonObject { ["role"] = "user", ["content"] = request.Prompt }),
        };
        if (!string.IsNullOrWhiteSpace(request.System)) body["system"] = request.System;

        using var message = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/v1/messages") { Content = JsonContent.Create(body) };
        message.Headers.Add("x-api-key", Settings.ApiKey);
        message.Headers.Add("anthropic-version", Settings.AnthropicVersion);

        var response = await SendAsync(message, cancellationToken);
        if (response["stop_reason"]?.GetValue<string>() == "refusal")
            throw new LlmException("The model declined this request.");

        // Only text blocks carry the answer; thinking blocks and others are skipped.
        var text = string.Concat((response["content"] as JsonArray ?? [])
            .OfType<JsonObject>()
            .Where(block => block["type"]?.GetValue<string>() == "text")
            .Select(block => block["text"]?.GetValue<string>()));
        return text.Length > 0 ? text : throw new LlmException("The model returned no text.");
    }

    private async Task<string> CompleteOpenAiAsync(LlmRequest request, CancellationToken cancellationToken)
    {
        var baseUrl = (Settings.BaseUrl ?? "https://api.openai.com/v1").TrimEnd('/');
        var messages = new JsonArray();
        if (!string.IsNullOrWhiteSpace(request.System))
            messages.Add(new JsonObject { ["role"] = "system", ["content"] = request.System });
        messages.Add(new JsonObject { ["role"] = "user", ["content"] = request.Prompt });

        var body = new JsonObject
        {
            ["model"] = request.Model ?? Settings.Model,
            ["max_tokens"] = request.MaxTokens,
            ["messages"] = messages,
        };

        using var message = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/chat/completions") { Content = JsonContent.Create(body) };
        if (!string.IsNullOrWhiteSpace(Settings.ApiKey))
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Settings.ApiKey);

        var response = await SendAsync(message, cancellationToken);
        return response["choices"]?[0]?["message"]?["content"]?.GetValue<string>()
            ?? throw new LlmException("The model returned no message content.");
    }

    private async Task<JsonNode> SendAsync(HttpRequestMessage message, CancellationToken cancellationToken)
    {
        HttpResponseMessage response;
        try
        {
            response = await httpClientFactory.CreateClient(HttpClientName).SendAsync(message, cancellationToken);
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new LlmTimeoutException($"{Provider} API did not respond in time.");
        }
        using var _ = response;
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new LlmException($"{Provider} API returned {(int)response.StatusCode}: {text}");
        return JsonNode.Parse(text) ?? throw new LlmException($"{Provider} API returned an empty response.");
    }
}
