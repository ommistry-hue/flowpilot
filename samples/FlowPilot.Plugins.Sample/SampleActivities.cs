using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using FlowPilot.Abstractions;

namespace FlowPilot.Plugins.Sample;

[Activity("text.transform", DisplayName = "Transform text", Category = "Text", Icon = "type",
    Description = "Converts text to upper case, lower case or a URL slug. Output: { text }.")]
public sealed partial class TextTransformActivity : IActivity
{
    [Input(Required = true, Description = "Text to transform; supports {{ }} templates.")]
    public string Text { get; set; } = "";

    [Input(Kind = InputKind.Select, Options = ["upper", "lower", "slug"], DefaultValue = "upper")]
    public string Mode { get; set; } = "upper";

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        string? result = Mode switch
        {
            "upper" => Text.ToUpperInvariant(),
            "lower" => Text.ToLowerInvariant(),
            "slug" => Slugify(Text),
            _ => null,
        };

        return Task.FromResult(result is null
            ? ActivityResult.Fail($"Unknown mode '{Mode}'. Use upper, lower or slug.")
            : ActivityResult.Done(new JsonObject { ["text"] = result }));
    }

    private static string Slugify(string text)
    {
        var normalized = text.Normalize(NormalizationForm.FormD);
        var ascii = new string(normalized.Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).ToArray());
        return NonSlugCharacters().Replace(ascii.ToLowerInvariant(), "-").Trim('-');
    }

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonSlugCharacters();
}

[Activity("random.number", DisplayName = "Random number", Category = "Data", Icon = "dice-5",
    Description = "Picks a random number between min and max (inclusive for integers). Output: { value }.")]
public sealed class RandomNumberActivity : IActivity
{
    [Input(Kind = InputKind.Number, DefaultValue = 0)]
    public double Min { get; set; }

    [Input(Kind = InputKind.Number, DefaultValue = 100)]
    public double Max { get; set; } = 100;

    [Input(Kind = InputKind.Boolean, DefaultValue = true, Description = "Round to a whole number.")]
    public bool Integer { get; set; } = true;

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        if (Max < Min) return Task.FromResult(ActivityResult.Fail("'max' must be greater than or equal to 'min'."));

        JsonNode value = Integer
            ? Random.Shared.NextInt64((long)Math.Ceiling(Min), (long)Math.Floor(Max) + 1)
            : Min + Random.Shared.NextDouble() * (Max - Min);
        return Task.FromResult(ActivityResult.Done(new JsonObject { ["value"] = value }));
    }
}
