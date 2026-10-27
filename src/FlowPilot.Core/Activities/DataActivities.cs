using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core.Engine;
using Microsoft.Extensions.Logging;

namespace FlowPilot.Core.Activities;

[Activity("variable.set", DisplayName = "Set variable", Category = "Data", Icon = "variable",
    Description = "Stores a value in the run variables (vars.<name>). Output: the value.")]
public sealed class SetVariableActivity : IActivity
{
    [Input(DisplayName = "Variable name", Required = true)]
    public string Name { get; set; } = "";

    [Input(DisplayName = "Value", Description = "Any value; use {{ expr }} to keep the JS type, e.g. {{ vars.total + 1 }}.")]
    public JsonNode? Value { get; set; }

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        context.Variables[Name] = Value.Clone();
        return Task.FromResult(ActivityResult.Done(Value.Clone()));
    }
}

[Activity("script", DisplayName = "Script", Category = "Data", Icon = "code",
    Description = "Runs sandboxed JavaScript. Use 'return' to produce the output. Scope: input, vars, nodes, trigger, run, item, index.")]
public sealed class ScriptActivity : IActivity
{
    [Input(DisplayName = "Code", Kind = InputKind.Code, Required = true, DefaultValue = "return input;")]
    public string Code { get; set; } = "";

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        var output = context.Expressions.Evaluate($"(function () {{\n{Code}\n}})()");
        return Task.FromResult(ActivityResult.Done(output));
    }
}

[Activity("log", DisplayName = "Log", Category = "Data", Icon = "file-text",
    Description = "Writes a message to the server log and the node output.")]
public sealed class LogActivity(SecretStore secrets) : IActivity
{
    [Input(DisplayName = "Message", Kind = InputKind.Multiline, Required = true)]
    public string Message { get; set; } = "";

    [Input(DisplayName = "Level", Kind = InputKind.Select, Options = ["debug", "info", "warning", "error"], DefaultValue = "info")]
    public string Level { get; set; } = "info";

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        var level = Level switch
        {
            "debug" => LogLevel.Debug,
            "warning" => LogLevel.Warning,
            "error" => LogLevel.Error,
            _ => LogLevel.Information,
        };
        context.Logger.Log(level, "[run {RunId}] {Message}", context.RunId, secrets.Mask(Message));
        return Task.FromResult(ActivityResult.Done(new JsonObject { ["level"] = Level, ["message"] = Message }));
    }
}
