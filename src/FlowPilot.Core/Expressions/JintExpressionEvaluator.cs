using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using FlowPilot.Abstractions;
using Jint;
using Jint.Native;
using Jint.Native.Json;
using Jint.Runtime;
using JsEngine = Jint.Engine;

namespace FlowPilot.Core.Expressions;

public sealed class ExpressionException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// Evaluates JavaScript in a sandboxed Jint engine. The scope (input, vars, nodes, trigger, run, item, index)
/// is fixed per node execution; values cross the boundary as JSON so no CLR objects leak into scripts.
/// </summary>
public sealed partial class JintExpressionEvaluator(IReadOnlyDictionary<string, JsonNode?> scope) : IExpressionEvaluator
{
    [GeneratedRegex(@"\{\{(.+?)\}\}", RegexOptions.Singleline)]
    private static partial Regex TemplatePattern();

    [GeneratedRegex(@"^\s*\{\{(.+?)\}\}\s*$", RegexOptions.Singleline)]
    private static partial Regex SingleTemplatePattern();

    public JsonNode? Evaluate(string expression, IReadOnlyDictionary<string, JsonNode?>? extraScope = null)
    {
        var engine = CreateEngine();
        try
        {
            foreach (var (name, value) in scope) engine.SetValue(name, ToJs(engine, value));
            if (extraScope is not null)
                foreach (var (name, value) in extraScope) engine.SetValue(name, ToJs(engine, value));

            return FromJs(engine, engine.Evaluate(expression));
        }
        catch (StatementsCountOverflowException ex)
        {
            throw new ExpressionException($"Script exceeded the limit of {MaxStatements} statements.", ex);
        }
        catch (MemoryLimitExceededException ex)
        {
            throw new ExpressionException($"Script exceeded the memory limit of {MemoryLimitBytes / 1_000_000} MB.", ex);
        }
        catch (TimeoutException ex)
        {
            throw new ExpressionException($"Script exceeded the time limit of {Timeout.TotalSeconds:0} s.", ex);
        }
        catch (Exception ex) when (ex is JintException or System.Text.RegularExpressions.RegexMatchTimeoutException)
        {
            throw new ExpressionException($"Expression failed: {ex.Message}", ex);
        }
        catch (Acornima.ParseErrorException ex)
        {
            throw new ExpressionException($"Invalid expression: {ex.Message}", ex);
        }
    }

    public static bool IsTemplate(string value) => value.Contains("{{", StringComparison.Ordinal);

    /// <summary>A lone <c>{{ expr }}</c> keeps the JS result type; mixed text interpolates to a string.</summary>
    public JsonNode? EvaluateTemplate(string template)
    {
        var single = SingleTemplatePattern().Match(template);
        if (single.Success && TemplatePattern().Matches(template).Count == 1)
            return Evaluate(single.Groups[1].Value);

        return JsonValue.Create(TemplatePattern().Replace(template, m => FlowPilotJson.AsText(Evaluate(m.Groups[1].Value))));
    }

    /// <summary>Evaluates every templated string in <paramref name="config"/>, skipping keys holding raw code or expressions.</summary>
    public JsonObject EvaluateConfig(JsonObject config, IReadOnlySet<string> rawKeys)
    {
        var result = new JsonObject();
        foreach (var (key, value) in config)
            result[key] = rawKeys.Contains(key) ? value.Clone() : EvaluateNode(value);
        return result;
    }

    private JsonNode? EvaluateNode(JsonNode? node) => node switch
    {
        JsonObject obj => new JsonObject(obj.Select(p => KeyValuePair.Create(p.Key, EvaluateNode(p.Value)))),
        JsonArray arr => new JsonArray(arr.Select(EvaluateNode).ToArray()),
        JsonValue v when v.TryGetValue<string>(out var s) && IsTemplate(s) => EvaluateTemplate(s),
        _ => node.Clone(),
    };

    // Every evaluation, whether a {{ }} template, a condition or a script body, gets a fresh engine with
    // these limits. CLR interop is off by default in Jint and is never enabled here.
    private const int MaxStatements = 100_000;
    private const long MemoryLimitBytes = 4_000_000;
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(2);

    private static JsEngine CreateEngine() => new(options => options
        .TimeoutInterval(Timeout)
        .LimitMemory(MemoryLimitBytes)
        .MaxStatements(MaxStatements)
        .LimitRecursion(256)
        .RegexTimeoutInterval(TimeSpan.FromSeconds(1))
        .Strict(false));

    private static JsValue ToJs(JsEngine engine, JsonNode? value) =>
        value is null ? JsValue.Null : new JsonParser(engine).Parse(value.ToJsonString());

    private static JsonNode? FromJs(JsEngine engine, JsValue value)
    {
        if (value.IsUndefined() || value.IsNull()) return null;
        var json = new JsonSerializer(engine).Serialize(value);
        return json.IsUndefined() ? null : JsonNode.Parse(json.AsString());
    }
}
