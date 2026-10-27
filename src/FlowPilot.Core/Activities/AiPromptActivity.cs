using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core.AI;

namespace FlowPilot.Core.Activities;

[Activity("ai.prompt", DisplayName = "AI prompt", Category = "AI", Icon = "sparkles",
    Description = "Sends a prompt to the configured LLM provider. Output: { text, json? }.")]
public sealed class AiPromptActivity(ILlmClient llm) : IActivity
{
    [Input(DisplayName = "Prompt", Kind = InputKind.Multiline, Required = true)]
    public string Prompt { get; set; } = "";

    [Input(DisplayName = "System prompt", Kind = InputKind.Multiline, Description = "Optional system prompt.")]
    public string? System { get; set; }

    [Input(DisplayName = "Model", Description = "Overrides the configured model.")]
    public string? Model { get; set; }

    [Input(DisplayName = "Parse JSON reply", Kind = InputKind.Boolean, DefaultValue = false, Description = "Parse the reply as JSON into output.json.")]
    public bool Json { get; set; }

    public async Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        if (!llm.Enabled) return ActivityResult.Fail("AI is not configured on this server.");

        string text;
        try
        {
            text = await llm.CompleteAsync(new LlmRequest(Prompt, System, string.IsNullOrWhiteSpace(Model) ? null : Model), cancellationToken);
        }
        catch (Exception ex) when (ex is LlmException or HttpRequestException)
        {
            return ActivityResult.Fail(ex.Message);
        }

        var output = new JsonObject { ["text"] = text };
        if (Json)
        {
            var parsed = JsonExtraction.TryParse(text);
            if (parsed is null) return ActivityResult.Fail("The model reply is not valid JSON.");
            output["json"] = parsed;
        }
        return ActivityResult.Done(output);
    }
}
