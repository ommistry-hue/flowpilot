using System.Net;
using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core;
using FlowPilot.Core.Activities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace FlowPilot.Tests;

public sealed class ConfigurationTests
{
    [Theory]
    [InlineData("127.0.0.1", false)]
    [InlineData("10.1.2.3", false)]
    [InlineData("172.20.0.1", false)]
    [InlineData("192.168.1.1", false)]
    [InlineData("169.254.169.254", false)]
    [InlineData("100.64.0.1", false)]
    [InlineData("::1", false)]
    [InlineData("fd00::1", false)]
    [InlineData("fe80::1", false)]
    [InlineData("::ffff:10.0.0.1", false)]
    [InlineData("8.8.8.8", true)]
    [InlineData("172.32.0.1", true)]
    [InlineData("2606:4700:4700::1111", true)]
    public void Network_guard_only_allows_public_addresses(string address, bool expected)
    {
        Assert.Equal(expected, NetworkGuard.IsPublic(IPAddress.Parse(address)));
    }

    [Fact]
    public void Settings_bind_from_the_FlowPilot_section_with_documented_defaults()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:FlowPilot"] = "Host=db;Database=flowpilot",
            ["FlowPilot:Database:Provider"] = "postgres",
            ["FlowPilot:ApiKey"] = "secret",
            ["FlowPilot:AI:ApiKey"] = "sk-test",
            ["FlowPilot:Http:BlockPrivateNetworks"] = "true",
        }).Build();

        var services = new ServiceCollection().AddSingleton<IConfiguration>(configuration);
        services.AddFlowPilot();
        var options = services.BuildServiceProvider().GetRequiredService<IOptions<FlowPilotOptions>>().Value;

        Assert.True(options.IsPostgres);
        Assert.Equal("Host=db;Database=flowpilot", options.ConnectionString);
        Assert.Equal("secret", options.ApiKey);
        Assert.True(options.AI.Enabled);
        Assert.Equal("claude-sonnet-5-5", options.AI.Model);
        Assert.Equal("2026-10-21", options.AI.AnthropicVersion);
        Assert.True(options.Http.BlockPrivateNetworks);
        Assert.Equal(1024 * 1024, options.Webhooks.MaxBodyBytes);
    }

    [Fact]
    public void Readme_embedding_snippet_registers_a_custom_activity()
    {
        var services = new ServiceCollection().AddLogging();
        services.AddFlowPilot(o => o.PluginsPath = "")
            .AddActivity<ReverseText>();

        var registry = services.BuildServiceProvider().GetRequiredService<ActivityRegistry>();
        var descriptor = registry.Find("text.reverse")!.Descriptor;

        Assert.Equal("Reverse text", descriptor.DisplayName);
        Assert.Equal("text", Assert.Single(descriptor.Inputs).Name);
    }

    // Copied verbatim from README.md, "Write a custom activity in 10 lines".
    [Activity("text.reverse", DisplayName = "Reverse text", Category = "Text")]
    public sealed class ReverseText : IActivity
    {
        [Input(Required = true)] public string Text { get; set; } = "";

        public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken ct) =>
            Task.FromResult(ActivityResult.Done(new JsonObject { ["result"] = new string(Text.Reverse().ToArray()) }));
    }
}
