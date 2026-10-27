using System.Collections;
using System.Text.Json.Nodes;

namespace FlowPilot.Core.Engine;

/// <summary>
/// Secrets exposed to expressions as <c>secrets.NAME</c>, read from <c>FLOWPILOT_SECRET_NAME</c> environment variables.
/// Values never live in workflow JSON, and <see cref="Mask(string?)"/> scrubs them from everything the engine persists or logs.
/// </summary>
public sealed class SecretStore
{
    public const string EnvironmentPrefix = "FLOWPILOT_SECRET_";
    public const string Masked = "***";

    private readonly IReadOnlyDictionary<string, string> _secrets;
    private readonly string[] _valuesLongestFirst;

    public SecretStore(IReadOnlyDictionary<string, string> secrets)
    {
        _secrets = secrets;
        _valuesLongestFirst = secrets.Values.Where(v => v.Length > 0).Distinct().OrderByDescending(v => v.Length).ToArray();
    }

    public static SecretStore FromEnvironment()
    {
        var secrets = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            var key = (string)entry.Key;
            if (key.StartsWith(EnvironmentPrefix, StringComparison.OrdinalIgnoreCase) && key.Length > EnvironmentPrefix.Length)
                secrets[key[EnvironmentPrefix.Length..]] = entry.Value as string ?? "";
        }
        return new SecretStore(secrets);
    }

    public IReadOnlyCollection<string> Names => _secrets.Keys.ToList();

    public JsonObject ToScope()
    {
        var scope = new JsonObject();
        foreach (var (name, value) in _secrets) scope[name] = value;
        return scope;
    }

    public string? Mask(string? text)
    {
        if (string.IsNullOrEmpty(text) || _valuesLongestFirst.Length == 0) return text;
        foreach (var value in _valuesLongestFirst)
            text = text.Replace(value, Masked, StringComparison.Ordinal);
        return text;
    }

    /// <summary>Masks secret values inside the string values of a JSON document, keeping it valid JSON.</summary>
    public string? MaskJson(string? json)
    {
        if (string.IsNullOrEmpty(json) || _valuesLongestFirst.Length == 0) return json;
        return FlowPilotJson.ToJson(MaskNode(JsonNode.Parse(json)));
    }

    public JsonNode? MaskNode(JsonNode? node)
    {
        if (_valuesLongestFirst.Length == 0) return node;
        return node switch
        {
            JsonObject obj => new JsonObject(obj.Select(p => KeyValuePair.Create(p.Key, MaskNode(p.Value)))),
            JsonArray array => new JsonArray(array.Select(MaskNode).ToArray()),
            JsonValue value when value.TryGetValue<string>(out var text) => JsonValue.Create(Mask(text)),
            _ => node?.DeepClone(),
        };
    }
}
