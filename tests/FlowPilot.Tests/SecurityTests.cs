using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core.Activities;
using FlowPilot.Core.Contracts;
using FlowPilot.Core.Engine;
using FlowPilot.Core.Services;
using FlowPilot.Tests.Infrastructure;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace FlowPilot.Tests;

public sealed class SecurityTests
{
    private const string Token = "s3cr3t-T0ken-value";

    [Theory, Sqlite, Postgres]
    public async Task Secrets_are_usable_in_expressions_but_masked_everywhere_they_are_persisted(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider, secrets: new Dictionary<string, string> { ["API_TOKEN"] = Token });
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("length", "script", new { code = "return { length: secrets.API_TOKEN.length, echo: 'Bearer ' + secrets.API_TOKEN };" })
            .Node("store", "variable.set", new { name = "leak", value = "{{ secrets.API_TOKEN }}" })
            .Node("log", "log", new { message = "token={{ secrets.API_TOKEN }}" })
            .Edge("start", "length").Edge("length", "store").Edge("store", "log")
            .Build();

        var run = await engine.RunAsync(workflow);

        Assert.Equal(RunStatus.Completed, run.Status);
        var length = run.Nodes.Single(n => n.NodeId == "length").Output!;
        Assert.Equal(Token.Length, length["length"]!.GetValue<int>()); // the script saw the real value
        Assert.Equal("Bearer ***", length["echo"]!.GetValue<string>());
        Assert.Equal("***", run.Variables["leak"]!.GetValue<string>());
        Assert.Equal("token=***", run.Nodes.Single(n => n.NodeId == "log").Output!["message"]!.GetValue<string>());

        var persisted = await engine.WithDbAsync(async db => string.Join("\n",
            db.NodeExecutions.Select(e => e.InputJson + e.OutputJson + e.Error).ToList()
                .Concat(db.WorkflowRuns.Select(r => r.VariablesJson + r.OutputsJson + r.Error).ToList())));
        Assert.DoesNotContain(Token, persisted);
    }

    [Theory, Sqlite, Postgres]
    public async Task Webhook_triggers_with_a_secret_require_the_header_or_a_valid_signature(string provider)
    {
        await using var engine = await EngineHarness.CreateAsync(provider, secrets: new Dictionary<string, string> { ["HOOK"] = "hook-secret" });
        await engine.WithScopeAsync(async sp =>
        {
            var store = sp.GetRequiredService<WorkflowStore>();
            var workflow = new WorkflowBuilder()
                .Node("hook", "trigger.webhook", new { path = "secure", method = "POST", secret = "{{ secrets.HOOK }}" })
                .Build();
            var created = await store.CreateAsync(workflow);
            return await store.PublishAsync(created.Id);
        });

        var body = Encoding.UTF8.GetBytes("{\"id\":1}");
        var signature = "sha256=" + Convert.ToHexStringLower(HMACSHA256.HashData("hook-secret"u8.ToArray(), body));
        Task<WebhookDispatch> Call(string? secretHeader, string? signatureHeader) => engine.WithRuntimeAsync(r =>
            r.TriggerWebhookAsync(new WebhookRequest("secure", "POST", new JsonObject(), body, secretHeader, signatureHeader)));

        var anonymous = await Call(null, null);
        Assert.True(anonymous.Matched);
        Assert.Empty(anonymous.RunIds);
        Assert.Empty((await Call("wrong", null)).RunIds);
        Assert.Empty((await Call(null, "sha256=" + new string('0', 64))).RunIds);
        Assert.Single((await Call("hook-secret", null)).RunIds);
        Assert.Single((await Call(null, signature)).RunIds);
        Assert.Single((await Call(null, signature.ToUpperInvariant().Replace("SHA256=", "sha256="))).RunIds);
    }

    [Fact]
    public async Task Http_responses_larger_than_the_limit_fail_the_node()
    {
        await using var target = WebApplication.CreateBuilder().Build();
        target.Urls.Add("http://127.0.0.1:0");
        target.MapGet("/small", () => new string('a', 100));
        target.MapGet("/large", () => new string('a', 5000));
        target.MapGet("/chunked", async (HttpContext http) =>
        {
            for (var i = 0; i < 10; i++) await http.Response.WriteAsync(new string('b', 1000)); // no Content-Length
        });
        await target.StartAsync();
        var baseUrl = target.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();

        await using var engine = await EngineHarness.CreateAsync(configure: o => o.Http.MaxResponseBytes = 2000);
        foreach (var (path, ok) in new[] { ("small", true), ("large", false), ("chunked", false) })
        {
            var workflow = new WorkflowBuilder()
                .Node("start", "trigger.manual")
                .Node("call", "http.request", new { url = $"{baseUrl}/{path}" })
                .Edge("start", "call")
                .Build();

            var run = await engine.RunAsync(workflow);

            Assert.Equal(ok ? RunStatus.Completed : RunStatus.Failed, run.Status);
            if (!ok) Assert.Contains("larger than 2000 bytes", run.Nodes.Last().Error);
        }
        await target.StopAsync();
    }

    [Theory]
    [InlineData("64:ff9b::a00:1")]
    [InlineData("2002:c0a8:101::1")]
    public void Network_guard_blocks_ipv6_ranges_that_embed_ipv4(string address)
    {
        Assert.False(NetworkGuard.IsPublic(IPAddress.Parse(address)));
    }

    [Fact]
    public async Task Built_in_inputs_have_readable_display_names()
    {
        await using var engine = await EngineHarness.CreateAsync();
        var registry = engine.Services.GetRequiredService<ActivityRegistry>();

        string Name(string type, string input) => registry.Find(type)!.Descriptor.Inputs.Single(i => i.Name == input).DisplayName;

        Assert.Equal("URL", Name("http.request", "url"));
        Assert.Equal("Timeout (ms)", Name("http.request", "timeoutMs"));
        Assert.Equal("Duration (ms)", Name("delay", "durationMs"));
        Assert.Equal("Shared secret", Name("trigger.webhook", "secret"));
        Assert.All(registry.Descriptors.Where(d => !d.Type.StartsWith("test.")).SelectMany(d => d.Inputs),
            i => Assert.DoesNotMatch("Ms$|Url|Json$", i.DisplayName));
    }

    [Fact]
    public async Task Validator_accepts_case_handles_on_any_activity_with_dynamic_outcomes()
    {
        await using var engine = await EngineHarness.CreateAsync();
        var workflow = new WorkflowBuilder()
            .Node("start", "trigger.manual")
            .Node("route", "test.router", new { cases = new[] { new { name = "east" } } })
            .Node("x", "log", new { message = "x" })
            .Edge("start", "route").Edge("route", "x", "east").Edge("route", "x", "default")
            .Build();

        Assert.True(engine.Services.GetRequiredService<WorkflowValidator>().Validate(workflow).Valid);
        Assert.Equal(RunStatus.Completed, (await engine.RunAsync(workflow)).Status);
    }
}
