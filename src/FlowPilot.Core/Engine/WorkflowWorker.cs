using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FlowPilot.Core.Engine;

/// <summary>
/// Keeps up to <see cref="EngineOptions.Workers"/> work items in flight. The claim loop only claims as many
/// items as there are free slots and runs each on the thread pool, so a slow activity never blocks claiming.
/// It wakes as soon as new work is signalled in-process, and otherwise polls every <see cref="FlowPilotOptions.PollInterval"/>.
/// </summary>
public sealed class WorkflowWorker(
    WorkItemExecutor executor,
    IServiceScopeFactory scopeFactory,
    WorkerSignal signal,
    TimeProvider clock,
    IOptions<FlowPilotOptions> options,
    ILogger<WorkflowWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var workers = Math.Max(1, options.Value.Engine.Workers);
        using var slots = new SemaphoreSlim(workers, workers);
        var running = new List<Task>();
        var nextDelayCheck = DateTimeOffset.MinValue;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // Delay bookmarks only need polling resolution, not a query per wake-up.
                if (clock.GetUtcNow() >= nextDelayCheck)
                {
                    await ResumeDueDelaysAsync(stoppingToken);
                    nextDelayCheck = clock.GetUtcNow() + options.Value.PollInterval;
                }

                var free = slots.CurrentCount;
                var claimed = free > 0 ? await executor.ClaimAsync(free, stoppingToken) : [];
                foreach (var id in claimed)
                {
                    // Never cancelled: we claimed at most the free slots, and an item we claimed must be
                    // started so that a shutdown releases it rather than leaving it locked.
                    await slots.WaitAsync(CancellationToken.None);
                    running.Add(Task.Run(() => RunAsync(id, slots, stoppingToken), CancellationToken.None));
                }
                running.RemoveAll(t => t.IsCompleted);

                // A full batch probably means more work is waiting; otherwise sleep until signalled or polled.
                if (claimed.Count < free || slots.CurrentCount == 0)
                    await signal.WaitAsync(options.Value.PollInterval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Workflow worker loop failed");
                await Task.Delay(options.Value.PollInterval, CancellationToken.None);
            }
        }

        await Task.WhenAll(running);
    }

    private async Task RunAsync(Guid workItemId, SemaphoreSlim slots, CancellationToken stoppingToken)
    {
        try
        {
            await executor.ExecuteAsync(workItemId, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            // The lease expires and the item is retried; at-least-once delivery covers this.
            logger.LogError(ex, "Executing work item {WorkItemId} failed", workItemId);
        }
        finally
        {
            slots.Release();
            signal.Notify();
        }
    }

    private async Task ResumeDueDelaysAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        await scope.ServiceProvider.GetRequiredService<WorkflowRuntime>().ResumeDueDelaysAsync(ct);
    }
}
