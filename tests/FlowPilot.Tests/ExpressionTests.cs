using System.Text.Json;
using System.Text.Json.Nodes;
using FlowPilot.Core.Engine;
using FlowPilot.Core.Expressions;

namespace FlowPilot.Tests;

public sealed class ExpressionTests
{
    private static JintExpressionEvaluator Evaluator() => new(new Dictionary<string, JsonNode?>
    {
        ["input"] = new JsonObject { ["total"] = 120, ["name"] = "Ada", ["items"] = new JsonArray(1, 2, 3) },
        ["vars"] = new JsonObject { ["count"] = 2 },
    });

    [Theory]
    [InlineData("{{ input.total + 1 }}", JsonValueKind.Number, "121")]
    [InlineData("{{ input.total > 100 }}", JsonValueKind.True, "true")]
    [InlineData("  {{ input.items.map(x => x * 2) }} ", JsonValueKind.Array, "[2,4,6]")]
    [InlineData("{{ ({ who: input.name }) }}", JsonValueKind.Object, "{\"who\":\"Ada\"}")]
    [InlineData("Hello {{ input.name }}, you have {{ vars.count }} items", JsonValueKind.String, "\"Hello Ada, you have 2 items\"")]
    [InlineData("{{ input.name }}{{ vars.count }}", JsonValueKind.String, "\"Ada2\"")]
    public void Single_template_keeps_the_js_type_and_mixed_text_interpolates(string template, JsonValueKind kind, string json)
    {
        var result = Evaluator().EvaluateTemplate(template);

        Assert.Equal(kind, result!.GetValueKind());
        Assert.Equal(json, result.ToJsonString());
    }

    [Fact]
    public void Config_evaluation_templates_nested_values_but_leaves_raw_code_alone()
    {
        var config = new JsonObject
        {
            ["url"] = "https://example.com/{{ input.name }}",
            ["body"] = new JsonObject { ["count"] = "{{ vars.count }}" },
            ["code"] = "return '{{ not a template }}';",
        };

        var result = Evaluator().EvaluateConfig(config, new HashSet<string> { "code" });

        Assert.Equal("https://example.com/Ada", result["url"]!.GetValue<string>());
        Assert.Equal(2, result["body"]!["count"]!.GetValue<int>());
        Assert.Equal("return '{{ not a template }}';", result["code"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("while (true) {}")]
    [InlineData("this.constructor.constructor('return System')().IO")]
    [InlineData("syntax error (")]
    public void Sandbox_turns_runaway_or_invalid_scripts_into_expression_errors(string expression)
    {
        Assert.Throws<ExpressionException>(() => Evaluator().Evaluate(expression));
    }

    [Theory]
    [InlineData(1, 1000)]
    [InlineData(2, 2000)]
    [InlineData(3, 4000)]
    [InlineData(10, 5000)]
    public void Retry_delay_grows_exponentially_up_to_the_cap(int failedAttempt, int expectedMs)
    {
        var policy = new FlowPilot.Abstractions.RetryPolicy { InitialDelayMs = 1000, BackoffMultiplier = 2, MaxDelayMs = 5000 };

        Assert.Equal(TimeSpan.FromMilliseconds(expectedMs), WorkItemExecutor.RetryDelay(policy, failedAttempt));
    }
}
