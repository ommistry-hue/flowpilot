using FlowPilot.Core.Contracts;
using FlowPilot.Core.Engine;
using Microsoft.AspNetCore.SignalR;

namespace FlowPilot.Server.Realtime;

public sealed class RunsHub : Hub
{
    public static string RunGroup(Guid runId) => $"run:{runId}";

    public Task JoinRun(Guid runId) => Groups.AddToGroupAsync(Context.ConnectionId, RunGroup(runId));

    public Task LeaveRun(Guid runId) => Groups.RemoveFromGroupAsync(Context.ConnectionId, RunGroup(runId));
}

public sealed class SignalRRunEventSink(IHubContext<RunsHub> hub, ILogger<SignalRRunEventSink> logger) : IRunEventSink
{
    public Task NodeUpdatedAsync(NodeExecutionDto execution) =>
        SendAsync(() => hub.Clients.Group(RunsHub.RunGroup(execution.RunId)).SendAsync("nodeUpdated", execution));

    // Clients.All already includes the run's group, so one broadcast reaches both the run view and lists.
    public Task RunUpdatedAsync(RunSummary run) =>
        SendAsync(() => hub.Clients.All.SendAsync("runUpdated", run));

    public Task ApprovalsChangedAsync() =>
        SendAsync(() => hub.Clients.All.SendAsync("approvalsChanged"));

    private async Task SendAsync(Func<Task> send)
    {
        try
        {
            await send();
        }
        catch (Exception ex)
        {
            // A broken push must never fail a committed workflow step.
            logger.LogWarning(ex, "Failed to push a run event");
        }
    }
}
