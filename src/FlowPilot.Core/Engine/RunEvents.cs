using System.Threading.Channels;
using FlowPilot.Core.Contracts;

namespace FlowPilot.Core.Engine;

/// <summary>Receives run changes after they are committed. The server pushes them over SignalR.</summary>
public interface IRunEventSink
{
    Task NodeUpdatedAsync(NodeExecutionDto execution);
    Task RunUpdatedAsync(RunSummary run);
    Task ApprovalsChangedAsync();
}

public sealed class NullRunEventSink : IRunEventSink
{
    public Task NodeUpdatedAsync(NodeExecutionDto execution) => Task.CompletedTask;
    public Task RunUpdatedAsync(RunSummary run) => Task.CompletedTask;
    public Task ApprovalsChangedAsync() => Task.CompletedTask;
}

/// <summary>Wakes the in-process worker as soon as new work is enqueued instead of waiting for the next poll.</summary>
public sealed class WorkerSignal
{
    private readonly Channel<bool> _channel = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
    {
        FullMode = BoundedChannelFullMode.DropWrite,
    });

    public void Notify() => _channel.Writer.TryWrite(true);

    public async Task WaitAsync(TimeSpan timeout, CancellationToken cancellationToken)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(timeout);
        try
        {
            await _channel.Reader.ReadAsync(cts.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
        }
    }
}
