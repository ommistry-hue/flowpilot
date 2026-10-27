using System.Text.Json.Nodes;
using Cronos;
using FlowPilot.Abstractions;
using FlowPilot.Core.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace FlowPilot.Core.Engine;

/// <summary>
/// Fires <c>trigger.cron</c> nodes of published workflows. The next fire time is stored in ScheduleStates and
/// advanced with a compare-and-set, so several server instances never start the same occurrence twice.
/// </summary>
public sealed class CronScheduler(IServiceScopeFactory scopeFactory, TimeProvider clock, ILogger<CronScheduler> logger) : BackgroundService
{
    private static readonly TimeSpan TickInterval = TimeSpan.FromSeconds(1);

    // An explicit UTC value: DateTime.MaxValue is Kind=Unspecified, which Npgsql rejects for timestamptz.
    private static readonly DateTime NeverAgain = new(9999, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TickInterval, clock);
        do
        {
            try
            {
                await TickAsync(stoppingToken);
            }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            {
                logger.LogError(ex, "Cron scheduler tick failed");
            }
        }
        while (await WaitAsync(timer, stoppingToken));
    }

    private static async Task<bool> WaitAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try { return await timer.WaitForNextTickAsync(ct); }
        catch (OperationCanceledException) { return false; }
    }

    public async Task TickAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<FlowPilotDbContext>();
        var runtime = scope.ServiceProvider.GetRequiredService<WorkflowRuntime>();
        var now = clock.GetUtcNow().UtcDateTime;

        var states = await db.ScheduleStates.AsNoTracking().ToDictionaryAsync(s => (s.DefinitionId, s.NodeId), ct);
        var active = new HashSet<(Guid, string)>();

        foreach (var workflow in await runtime.LoadPublishedAsync(ct))
        {
            foreach (var node in workflow.Definition.Nodes.Where(n => n.Type == "trigger.cron"))
            {
                var key = (workflow.DefinitionId, node.Id);
                active.Add(key);

                var schedule = TryParse(node);
                if (schedule is null) continue;

                if (!states.TryGetValue(key, out var state))
                {
                    if (schedule.Next(now) is { } first)
                    {
                        db.ScheduleStates.Add(new ScheduleStateEntity { DefinitionId = key.DefinitionId, NodeId = key.Id, NextFireAt = first });
                        await SaveIgnoringDuplicatesAsync(db, ct);
                    }
                    continue;
                }

                if (state.NextFireAt > now) continue;

                var next = schedule.Next(now) ?? NeverAgain;
                var claimed = await db.ScheduleStates
                    .Where(s => s.DefinitionId == key.DefinitionId && s.NodeId == key.Id && s.NextFireAt == state.NextFireAt)
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.NextFireAt, next), ct);
                if (claimed == 0) continue;

                var input = new JsonObject { ["firedAt"] = state.NextFireAt };
                await runtime.StartAsync(workflow.DefinitionId, workflow.Definition, workflow.Version, node.Id, input, ct);
                logger.LogInformation("Cron trigger {NodeId} started workflow {Name}", node.Id, workflow.Definition.Name);
            }
        }

        var stale = states.Keys.Where(k => !active.Contains(k)).ToList();
        foreach (var (definitionId, nodeId) in stale)
            await db.ScheduleStates.Where(s => s.DefinitionId == definitionId && s.NodeId == nodeId).ExecuteDeleteAsync(ct);
    }

    private CronSchedule? TryParse(NodeDefinition node)
    {
        var expression = FlowPilotJson.AsText(node.Config["cron"]).Trim();
        if (expression.Length == 0) return null;
        try
        {
            var format = expression.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length == 6 ? CronFormat.IncludeSeconds : CronFormat.Standard;
            var zoneId = FlowPilotJson.AsText(node.Config["timezone"]).Trim();
            var zone = zoneId.Length == 0 ? TimeZoneInfo.Utc : TimeZoneInfo.FindSystemTimeZoneById(zoneId);
            return new CronSchedule(CronExpression.Parse(expression, format), zone);
        }
        catch (Exception ex) when (ex is CronFormatException or TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            logger.LogWarning("Invalid schedule on node {NodeId}: {Message}", node.Id, ex.Message);
            return null;
        }
    }

    private static async Task SaveIgnoringDuplicatesAsync(FlowPilotDbContext db, CancellationToken ct)
    {
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); } // another instance created it first
    }

    private sealed record CronSchedule(CronExpression Expression, TimeZoneInfo Zone)
    {
        public DateTime? Next(DateTime utcNow) => Expression.GetNextOccurrence(utcNow, Zone);
    }
}
