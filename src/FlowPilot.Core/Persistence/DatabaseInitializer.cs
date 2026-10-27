using FlowPilot.Core.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FlowPilot.Core.Persistence;

/// <summary>Creates the schema and seeds sample workflows before the worker starts.</summary>
public sealed class DatabaseInitializer(IServiceProvider services) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken) => InitializeAsync(services, cancellationToken);

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public static async Task InitializeAsync(IServiceProvider services, CancellationToken cancellationToken = default)
    {
        using var scope = services.CreateScope();
        var provider = scope.ServiceProvider;
        var db = provider.GetRequiredService<FlowPilotDbContext>();
        var options = provider.GetRequiredService<IOptions<FlowPilotOptions>>().Value;
        var logger = provider.GetRequiredService<ILogger<DatabaseInitializer>>();

        await db.Database.EnsureCreatedAsync(cancellationToken);
        if (db.Database.IsSqlite())
            await db.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;", cancellationToken);

        if (!options.SeedSampleWorkflows || await db.WorkflowDefinitions.AnyAsync(cancellationToken)) return;

        var store = provider.GetRequiredService<WorkflowStore>();
        foreach (var definition in SampleWorkflows.All())
        {
            var created = await store.CreateAsync(definition, cancellationToken);
            await store.PublishAsync(created.Id, cancellationToken);
        }
        logger.LogInformation("Seeded {Count} sample workflows", SampleWorkflows.All().Count());
    }
}
