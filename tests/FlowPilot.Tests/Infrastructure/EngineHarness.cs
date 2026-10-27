using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core;
using FlowPilot.Core.Contracts;
using FlowPilot.Core.Engine;
using FlowPilot.Core.Persistence;
using FlowPilot.Core.Services;
using FlowPilot.Plugins.Sample;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace FlowPilot.Tests.Infrastructure;

/// <summary>
/// A real engine over a throwaway database (a temp SQLite file, or a fresh PostgreSQL database), driven
/// synchronously: tests call <see cref="RunUntilIdleAsync"/> instead of relying on the background worker,
/// and it fast-forwards the fake clock to the next due item.
/// </summary>
public sealed class EngineHarness : IAsyncDisposable
{
    public const string PostgresVariable = "FLOWPILOT_TEST_POSTGRES";

    private readonly string _connectionString;
    private readonly bool _postgres;

    private EngineHarness(ServiceProvider services, TestClock clock, string connectionString, bool postgres)
    {
        Services = services;
        Clock = clock;
        _connectionString = connectionString;
        _postgres = postgres;
    }

    public ServiceProvider Services { get; }
    public TestClock Clock { get; }
    public WorkItemExecutor Executor => Services.GetRequiredService<WorkItemExecutor>();

    public static async Task<EngineHarness> CreateAsync(string provider = "sqlite", Action<FlowPilotOptions>? configure = null, IReadOnlyDictionary<string, string>? secrets = null)
    {
        var postgres = provider == "postgres";
        var connectionString = postgres
            ? new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable(PostgresVariable)) { Database = $"flowpilot_test_{Guid.NewGuid():N}" }.ConnectionString
            : $"Data Source={Path.Combine(Path.GetTempPath(), $"flowpilot-test-{Guid.NewGuid():N}.db")}";
        var clock = new TestClock(new DateTimeOffset(2026, 1, 1, 12, 0, 0, TimeSpan.Zero));

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<TimeProvider>(clock);
        services.AddSingleton(new SecretStore(secrets ?? new Dictionary<string, string>()));
        services.AddFlowPilot(o =>
            {
                o.DatabaseProvider = provider;
                o.ConnectionString = connectionString;
                o.SeedSampleWorkflows = false;
                o.PluginsPath = "";
                configure?.Invoke(o);
            })
            .AddActivity<FlakyActivity>()
            .AddActivity<GatedActivity>()
            .AddActivity<ThrowingActivity>()
            .AddActivity<RouterActivity>()
            .AddActivity<TextTransformActivity>();

        var serviceProvider = services.BuildServiceProvider();
        await DatabaseInitializer.InitializeAsync(serviceProvider);
        return new EngineHarness(serviceProvider, clock, connectionString, postgres);
    }

    public T Create<T>() => ActivatorUtilities.CreateInstance<T>(Services);

    public async Task<T> WithScopeAsync<T>(Func<IServiceProvider, Task<T>> action)
    {
        using var scope = Services.CreateScope();
        return await action(scope.ServiceProvider);
    }

    public Task<T> WithRuntimeAsync<T>(Func<WorkflowRuntime, Task<T>> action) =>
        WithScopeAsync(sp => action(sp.GetRequiredService<WorkflowRuntime>()));

    public Task<T> WithDbAsync<T>(Func<FlowPilotDbContext, Task<T>> action) =>
        WithScopeAsync(sp => action(sp.GetRequiredService<FlowPilotDbContext>()));

    public Task<Guid> StartAsync(WorkflowDefinition definition, JsonNode? input = null) =>
        WithRuntimeAsync(runtime => runtime.StartAsync(Guid.NewGuid(), definition, null, null, input));

    public async Task<RunDetail> RunAsync(WorkflowDefinition definition, JsonNode? input = null) =>
        await RunUntilIdleAsync(await StartAsync(definition, input));

    /// <param name="parallel">Execute each claimed batch concurrently, like the real worker does.</param>
    public async Task<RunDetail> RunUntilIdleAsync(Guid runId, bool advanceClock = true, bool parallel = false)
    {
        for (var i = 0; i < 1_000; i++)
        {
            var claimed = await Executor.ClaimAsync(10, CancellationToken.None);
            if (parallel)
                await Task.WhenAll(claimed.Select(id => Task.Run(() => Executor.ExecuteAsync(id, CancellationToken.None))));
            else
                foreach (var id in claimed) await Executor.ExecuteAsync(id, CancellationToken.None);

            var resumed = await WithRuntimeAsync(runtime => runtime.ResumeDueDelaysAsync());
            if (claimed.Count > 0 || resumed > 0) continue;

            if (!advanceClock || await NextDueAsync() is not { } next) break;
            Clock.SetUtcNow(next);
        }
        return await GetRunAsync(runId);
    }

    public Task<RunDetail> GetRunAsync(Guid runId) =>
        WithScopeAsync(async sp => (await sp.GetRequiredService<RunQueries>().GetAsync(runId))!);

    private Task<DateTimeOffset?> NextDueAsync() => WithDbAsync(async db =>
    {
        var nextItem = await db.WorkItems.MinAsync(w => (DateTime?)w.AvailableAt);
        var nextDelay = await db.Bookmarks.Where(b => b.ResolvedAt == null && b.ResumeAt != null).MinAsync(b => b.ResumeAt);
        var next = new[] { nextItem, nextDelay }.Where(d => d is not null).Min();
        return next is { } due && due > Clock.GetUtcNow().UtcDateTime
            ? new DateTimeOffset(due, TimeSpan.Zero)
            : (DateTimeOffset?)null;
    });

    public async ValueTask DisposeAsync()
    {
        if (_postgres)
        {
            await WithDbAsync(db => db.Database.EnsureDeletedAsync());
            NpgsqlConnection.ClearAllPools();
        }
        await Services.DisposeAsync();
        if (_postgres) return;

        SqliteConnection.ClearAllPools();
        var path = new SqliteConnectionStringBuilder(_connectionString).DataSource;
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try { File.Delete(path + suffix); }
            catch (IOException) { }
        }
    }
}

public sealed class TestClock(DateTimeOffset start) : TimeProvider
{
    private DateTimeOffset _now = start;

    public override DateTimeOffset GetUtcNow() => _now;

    public void SetUtcNow(DateTimeOffset now) => _now = now;

    public void Advance(TimeSpan by) => _now += by;
}

[Activity("test.flaky", Category = "Test", Description = "Fails the first N calls per run.")]
public sealed class FlakyActivity : IActivity
{
    private static readonly ConcurrentDictionary<Guid, int> Calls = new();

    [Input(Kind = InputKind.Number)]
    public int FailTimes { get; set; }

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        var call = Calls.AddOrUpdate(context.RunId, 1, (_, count) => count + 1);
        return Task.FromResult(call <= FailTimes
            ? ActivityResult.Fail($"boom #{call}")
            : ActivityResult.Done(new JsonObject { ["calls"] = call }));
    }
}

/// <summary>Throws instead of returning a result, like a buggy plugin or an HttpClient timeout.</summary>
[Activity("test.throws", Category = "Test")]
public sealed class ThrowingActivity : IActivity
{
    [Input] public string Mode { get; set; } = "crash";

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken) =>
        Mode == "cancel"
            ? throw new TaskCanceledException("The request was canceled due to the configured HttpClient.Timeout of 100 seconds elapsing.")
            : throw new InvalidCastException("Plugin bug");
}

/// <summary>A plugin-style activity whose outcomes come from its 'cases' config, like switch.</summary>
[Activity("test.router", Category = "Test", DynamicOutcomes = true, Outcomes = ["default"])]
public sealed class RouterActivity : IActivity
{
    [Input(Kind = InputKind.Json)] public JsonArray Cases { get; set; } = [];

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken) =>
        Task.FromResult(ActivityResult.WithOutcome(Cases.Count > 0 ? Cases[0]!["name"]!.GetValue<string>() : "default"));
}

/// <summary>Blocks until the test opens the gate registered for the run (or the token is cancelled).</summary>
[Activity("test.gated", Category = "Test")]
public sealed class GatedActivity : IActivity
{
    public static readonly ConcurrentDictionary<Guid, TaskCompletionSource> Gates = new();
    public static readonly ConcurrentDictionary<Guid, int> Entered = new();

    public async Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        Entered.AddOrUpdate(context.RunId, 1, (_, count) => count + 1);
        if (Gates.TryGetValue(context.RunId, out var gate))
            await gate.Task.WaitAsync(cancellationToken);
        return ActivityResult.Done(new JsonObject { ["passed"] = true });
    }

    public static TaskCompletionSource Close(Guid runId) =>
        Gates.GetOrAdd(runId, _ => new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));
}
