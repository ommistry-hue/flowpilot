using FlowPilot.Abstractions;
using FlowPilot.Core.Activities;
using FlowPilot.Core.AI;
using FlowPilot.Core.Engine;
using FlowPilot.Core.Persistence;
using FlowPilot.Core.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace FlowPilot.Core;

public sealed class FlowPilotBuilder(IServiceCollection services)
{
    public IServiceCollection Services { get; } = services;

    public FlowPilotBuilder AddActivity<TActivity>() where TActivity : class, IActivity => AddActivity(typeof(TActivity));

    public FlowPilotBuilder AddActivity(Type activityType)
    {
        if (!typeof(IActivity).IsAssignableFrom(activityType))
            throw new ArgumentException($"{activityType.FullName} does not implement IActivity.", nameof(activityType));
        Services.AddSingleton(new ActivityTypeRegistration(activityType));
        return this;
    }

    /// <summary>Registers every [Activity] class in the assembly.</summary>
    public FlowPilotBuilder AddActivitiesFrom(System.Reflection.Assembly assembly)
    {
        foreach (var type in ActivityScanner.FindActivityTypes(assembly)) AddActivity(type);
        return this;
    }
}

public static class FlowPilotServiceCollectionExtensions
{
    /// <summary>
    /// Adds the FlowPilot engine, persistence and background services. Settings are read from the
    /// <c>FlowPilot</c> configuration section and <c>ConnectionStrings:FlowPilot</c> when an <see cref="IConfiguration"/> is registered.
    /// </summary>
    public static FlowPilotBuilder AddFlowPilot(this IServiceCollection services, Action<FlowPilotOptions>? configure = null)
    {
        services.AddOptions<FlowPilotOptions>().Configure<IServiceProvider>((options, provider) =>
        {
            if (provider.GetService<IConfiguration>() is { } configuration) Bind(options, configuration);
            configure?.Invoke(options);
        });

        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<IRunEventSink, NullRunEventSink>();
        services.AddSingleton<WorkerSignal>();
        services.AddSingleton<RunCancellations>();
        services.TryAddSingleton(SecretStore.FromEnvironment());
        services.AddSingleton<ActivityRegistry>();
        services.AddSingleton<WorkItemExecutor>();
        services.AddSingleton<IWorkItemClaimer>(sp => sp.GetRequiredService<IOptions<FlowPilotOptions>>().Value.IsPostgres
            ? new PostgresWorkItemClaimer()
            : new SqliteWorkItemClaimer());

        services.AddDbContext<FlowPilotDbContext>((sp, db) =>
        {
            var options = sp.GetRequiredService<IOptions<FlowPilotOptions>>().Value;
            if (options.IsPostgres) db.UseNpgsql(options.ConnectionString);
            else db.UseSqlite(options.ConnectionString).AddInterceptors(SqlitePragmas.Instance);
        });

        services.AddScoped<WorkflowRuntime>();
        services.AddScoped<WorkflowStore>();
        services.AddScoped<RunQueries>();
        services.AddSingleton<WorkflowValidator>();
        services.AddSingleton<ILlmClient, LlmClient>();
        services.AddSingleton<WorkflowGenerator>();

        services.AddHttpClient(HttpRequestActivity.HttpClientName)
            .ConfigurePrimaryHttpMessageHandler(sp => NetworkGuard.CreateHandler(sp.GetRequiredService<IOptions<FlowPilotOptions>>().Value.Http));
        services.AddHttpClient(LlmClient.HttpClientName, client => client.Timeout = TimeSpan.FromMinutes(5));

        services.AddHostedService<DatabaseInitializer>();
        services.AddHostedService<WorkflowWorker>();
        services.AddHostedService<CronScheduler>();
        services.AddHostedService<RetentionService>();

        return new FlowPilotBuilder(services).AddActivitiesFrom(typeof(FlowPilotBuilder).Assembly);
    }

    private static void Bind(FlowPilotOptions options, IConfiguration configuration)
    {
        var section = configuration.GetSection("FlowPilot");
        options.DatabaseProvider = section["Database:Provider"] ?? options.DatabaseProvider;
        options.ConnectionString = configuration.GetConnectionString("FlowPilot") ?? options.ConnectionString;
        options.PluginsPath = section["PluginsPath"] ?? options.PluginsPath;
        options.ApiKey = NonEmpty(section["ApiKey"]) ?? options.ApiKey;
        if (bool.TryParse(section["SeedSampleWorkflows"], out var seed)) options.SeedSampleWorkflows = seed;
        if (int.TryParse(section["Engine:Workers"], out var workers)) options.Engine.Workers = Math.Max(4, workers);
        if (int.TryParse(section["Engine:MaxStepsPerRun"], out var maxSteps)) options.Engine.MaxStepsPerRun = maxSteps;
        if (bool.TryParse(section["Http:BlockPrivateNetworks"], out var blockPrivate)) options.Http.BlockPrivateNetworks = blockPrivate;
        if (long.TryParse(section["Http:MaxResponseBytes"], out var maxResponse)) options.Http.MaxResponseBytes = maxResponse;
        if (long.TryParse(section["Webhooks:MaxBodyBytes"], out var maxBody)) options.Webhooks.MaxBodyBytes = maxBody;
        if (int.TryParse(section["Retention:Days"], out var retentionDays)) options.Retention.Days = retentionDays;

        var ai = section.GetSection("AI");
        options.AI.Provider = NonEmpty(ai["Provider"]) ?? options.AI.Provider;
        options.AI.ApiKey = NonEmpty(ai["ApiKey"]) ?? options.AI.ApiKey;
        options.AI.Model = NonEmpty(ai["Model"]) ?? options.AI.Model;
        options.AI.BaseUrl = NonEmpty(ai["BaseUrl"]) ?? options.AI.BaseUrl;
        options.AI.AnthropicVersion = NonEmpty(ai["AnthropicVersion"]) ?? options.AI.AnthropicVersion;
    }

    private static string? NonEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;
}
