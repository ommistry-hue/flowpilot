using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;

namespace FlowPilot.Tests.Api;

/// <summary>The real server (Production environment) over a temp SQLite file, with the background worker running.</summary>
public sealed class FlowPilotApp : WebApplicationFactory<Program>
{
    public const string TestApiKey = "test-key-123";

    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"flowpilot-api-{Guid.NewGuid():N}.db");

    /// <summary>When set, the server requires this X-Api-Key.</summary>
    public string? ApiKey { get; init; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Production");
        builder.UseSetting("ConnectionStrings:FlowPilot", $"Data Source={_databasePath}");
        builder.UseSetting("FlowPilot:PluginsPath", "");
        builder.UseSetting("FlowPilot:ApiKey", ApiKey ?? "");
        builder.UseSetting("FlowPilot:Webhooks:MaxBodyBytes", "4096");
    }

    /// <summary>Polls the run until it reaches one of <paramref name="statuses"/> (e.g. "Completed").</summary>
    public static async Task<JsonObject> WaitForRunAsync(HttpClient client, string runId, params string[] statuses)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        while (true)
        {
            var run = (await client.GetFromJsonAsync<JsonObject>($"/api/runs/{runId}", timeout.Token))!;
            if (statuses.Contains(run["status"]!.GetValue<string>())) return run;
            await Task.Delay(50, timeout.Token);
        }
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        SqliteConnection.ClearAllPools();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try { File.Delete(_databasePath + suffix); }
            catch (IOException) { }
        }
    }
}
