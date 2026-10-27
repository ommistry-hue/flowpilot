using System.Text.Json;
using System.Text.Json.Nodes;

namespace FlowPilot.Core.AI;

public static class JsonExtraction
{
    /// <summary>Parses JSON from an LLM reply, tolerating markdown fences or prose around the payload.</summary>
    public static JsonNode? TryParse(string text)
    {
        var trimmed = text.Trim();
        if (trimmed.StartsWith("```", StringComparison.Ordinal))
        {
            var firstNewline = trimmed.IndexOf('\n');
            var closing = trimmed.LastIndexOf("```", StringComparison.Ordinal);
            if (firstNewline > 0 && closing > firstNewline) trimmed = trimmed[(firstNewline + 1)..closing].Trim();
        }

        if (TryParseExact(trimmed) is { } direct) return direct;

        var start = trimmed.IndexOfAny(['{', '[']);
        var end = trimmed.LastIndexOfAny(['}', ']']);
        return start >= 0 && end > start ? TryParseExact(trimmed[start..(end + 1)]) : null;
    }

    private static JsonNode? TryParseExact(string text)
    {
        try { return JsonNode.Parse(text); }
        catch (JsonException) { return null; }
    }
}
