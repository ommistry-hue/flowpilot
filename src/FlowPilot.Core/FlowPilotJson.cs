using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using FlowPilot.Abstractions;

namespace FlowPilot.Core;

/// <summary>The single JSON configuration shared by the API, persistence and SignalR.</summary>
public static class FlowPilotJson
{
    public static JsonSerializerOptions Options { get; } = Configure(new JsonSerializerOptions(JsonSerializerDefaults.Web));

    public static JsonSerializerOptions Configure(JsonSerializerOptions options)
    {
        options.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.DictionaryKeyPolicy = null;
        options.PropertyNameCaseInsensitive = true;
        options.NumberHandling = JsonNumberHandling.AllowReadingFromString;
        options.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
        if (!options.Converters.OfType<JsonStringEnumConverter>().Any())
            options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);

    public static T Deserialize<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, Options) ?? throw new JsonException($"Could not deserialize {typeof(T).Name}.");

    public static WorkflowDefinition ParseDefinition(string json) => Deserialize<WorkflowDefinition>(json);

    public static JsonNode? ParseNode(string? json) => string.IsNullOrEmpty(json) ? null : JsonNode.Parse(json);

    public static JsonObject ParseObject(string? json) => ParseNode(json) as JsonObject ?? [];

    public static string? ToJson(JsonNode? node) => node?.ToJsonString(Options);

    public static JsonNode? Clone(this JsonNode? node) => node?.DeepClone();

    /// <summary>Converts a JSON value to a plain string: strings unquoted, null empty, everything else as JSON.</summary>
    public static string AsText(JsonNode? node) => node switch
    {
        null => "",
        JsonValue v when v.TryGetValue<string>(out var s) => s,
        _ => node.ToJsonString(Options),
    };

    public static bool IsTruthy(JsonNode? node) => node switch
    {
        null => false,
        JsonValue v when v.TryGetValue<bool>(out var b) => b,
        JsonValue v when v.TryGetValue<double>(out var d) => d != 0 && !double.IsNaN(d),
        JsonValue v when v.TryGetValue<string>(out var s) => s.Length > 0,
        _ => true,
    };
}
