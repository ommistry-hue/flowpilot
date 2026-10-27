using FlowPilot.Core.Contracts;
using FlowPilot.Core.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FlowPilot.Core.Engine;

/// <summary>Deletes finished runs older than <c>FlowPilot:Retention:Days</c>, with their history and bookmarks.</summary>
public sealed class RetentionService(
    IServiceScopeFactory scopeFactory,
    IOptions<FlowPilotOptions> options,
    TimeProvider clock,
    ILogger<RetentionService> logger) : BackgroundService
{
    private const int BatchSize = 500;
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (options.Value.Retention.Days <= 0) return;

        using var timer = new PeriodicTimer(Interval, clock);
        do
        {
            try
            {
                var deleted = await PurgeAsync(stoppingToken);
                if (deleted > 0) logger.LogInformation("Retention removed {Count} runs older than {Days} days", deleted, options.Value.Retention.Days);
            }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            {
                logger.LogError(ex, "Run retention failed");
            }
        }
        while (await WaitAsync(timer, stoppingToken));
    }

    private static async Task<bool> WaitAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try { return await timer.WaitForNextTickAsync(ct); }
        catch (OperationCanceledException) { return false; }
    }

    /// <returns>The number of runs deleted.</returns>
    public async Task<int> PurgeAsync(CancellationToken ct = default)
    {
        var days = options.Value.Retention.Days;
        if (days <= 0) return 0;

        var cutoff = clock.GetUtcNow().UtcDateTime.AddDays(-days);
        var total = 0;
        while (true)
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<FlowPilotDbContext>();

            var runIds = await db.WorkflowRuns
                .Where(r => (r.Status == RunStatus.Completed || r.Status == RunStatus.Failed || r.Status == RunStatus.Cancelled)
                            && r.CompletedAt != null && r.CompletedAt < cutoff)
                .OrderBy(r => r.CompletedAt)
                .Select(r => r.Id)
                .Take(BatchSize)
                .ToListAsync(ct);
            if (runIds.Count == 0) return total;

            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.NodeExecutions.Where(e => runIds.Contains(e.RunId)).ExecuteDeleteAsync(ct);
            await db.Bookmarks.Where(b => runIds.Contains(b.RunId)).ExecuteDeleteAsync(ct);
            await db.WorkItems.Where(w => runIds.Contains(w.RunId)).ExecuteDeleteAsync(ct);
            total += await db.WorkflowRuns.Where(r => runIds.Contains(r.Id)).ExecuteDeleteAsync(ct);
            await transaction.CommitAsync(ct);
        }
    }
}
