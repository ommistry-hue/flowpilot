using System.Collections.Concurrent;

namespace FlowPilot.Core.Engine;

/// <summary>
/// Activities currently executing in this process, by run. Cancelling or failing a run aborts them at once;
/// other processes notice on their next lease renewal, because the run's work items are gone.
/// </summary>
public sealed class RunCancellations
{
    private readonly ConcurrentDictionary<Guid, ConcurrentDictionary<CancellationTokenSource, byte>> _active = new();

    public IDisposable Register(Guid runId, CancellationTokenSource abort)
    {
        _active.GetOrAdd(runId, _ => new()).TryAdd(abort, 0);
        return new Registration(this, runId, abort);
    }

    public void Cancel(Guid runId)
    {
        if (!_active.TryGetValue(runId, out var sources)) return;
        foreach (var source in sources.Keys)
        {
            try { source.Cancel(); }
            catch (ObjectDisposedException) { }
        }
    }

    private sealed class Registration(RunCancellations owner, Guid runId, CancellationTokenSource abort) : IDisposable
    {
        public void Dispose()
        {
            if (!owner._active.TryGetValue(runId, out var sources)) return;
            sources.TryRemove(abort, out _);
            if (sources.IsEmpty) owner._active.TryRemove(KeyValuePair.Create(runId, sources));
        }
    }
}
