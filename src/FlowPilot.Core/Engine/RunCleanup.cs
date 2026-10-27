using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core.Contracts;
using FlowPilot.Core.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FlowPilot.Core.Engine;

internal static class RunCleanup
{
    /// <summary>
    /// Closes what is still open when a run ends early: bookmarks are resolved, and running or suspended
    /// executions become Cancelled. Returns true when approvals were among the bookmarks.
    /// </summary>
    public static async Task<bool> StopOpenWorkAsync(FlowPilotDbContext db, Guid runId, RunStatus finalStatus, DateTime now, CancellationToken ct)
    {
        var status = finalStatus.ToString().ToLowerInvariant();
        var open = db.Bookmarks.Where(b => b.RunId == runId && b.ResolvedAt == null);
        var hadApprovals = await open.AnyAsync(b => b.Kind == BookmarkKind.Approval, ct);
        var resolution = new JsonObject { ["closed"] = true, ["runStatus"] = status }.ToJsonString();

        await open.ExecuteUpdateAsync(s => s
            .SetProperty(b => b.ResolvedAt, (DateTime?)now)
            .SetProperty(b => b.ResolutionJson, resolution), ct);

        await db.NodeExecutions
            .Where(e => e.RunId == runId && (e.Status == NodeExecutionStatus.Suspended || e.Status == NodeExecutionStatus.Running))
            .ExecuteUpdateAsync(s => s
                .SetProperty(e => e.Status, NodeExecutionStatus.Cancelled)
                .SetProperty(e => e.Error, $"Run {status}.")
                .SetProperty(e => e.CompletedAt, (DateTime?)now), ct);

        return hadApprovals;
    }
}
