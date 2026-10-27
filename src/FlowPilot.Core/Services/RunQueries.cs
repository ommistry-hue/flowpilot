using FlowPilot.Abstractions;
using FlowPilot.Core.Contracts;
using FlowPilot.Core.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FlowPilot.Core.Services;

/// <summary>Read models for runs, approvals and the dashboard.</summary>
public sealed class RunQueries(FlowPilotDbContext db, TimeProvider clock)
{
    public async Task<RunsPage> ListAsync(Guid? workflowId, RunStatus? status, int skip, int take, CancellationToken ct = default)
    {
        var query = db.WorkflowRuns.AsNoTracking();
        if (workflowId is { } id) query = query.Where(r => r.DefinitionId == id);
        if (status is { } s) query = query.Where(r => r.Status == s);

        var total = await query.CountAsync(ct);
        var runs = await query
            .OrderByDescending(r => r.CreatedAt)
            .Skip(Math.Max(0, skip))
            .Take(Math.Clamp(take, 1, 200))
            .ToListAsync(ct);

        var names = await WorkflowNamesAsync(runs.Select(r => r.DefinitionId), ct);
        var items = runs.Select(r => DtoMapper.ToSummary(r, names.GetValueOrDefault(r.DefinitionId) ?? "(deleted workflow)")).ToList();
        return new RunsPage(items, total);
    }

    public async Task<RunDetail?> GetAsync(Guid id, CancellationToken ct = default)
    {
        var run = await db.WorkflowRuns.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (run is null) return null;

        var executions = await db.NodeExecutions.AsNoTracking().Where(e => e.RunId == id).OrderBy(e => e.StartedAt).ToListAsync(ct);
        var bookmarks = await db.Bookmarks.AsNoTracking().Where(b => b.RunId == id).OrderBy(b => b.CreatedAt).ToListAsync(ct);
        return DtoMapper.ToDetail(run, executions, bookmarks);
    }

    public async Task<IReadOnlyList<ApprovalDto>> ApprovalsAsync(bool pending, CancellationToken ct = default)
    {
        var bookmarks = await db.Bookmarks.AsNoTracking()
            .Where(b => b.Kind == BookmarkKind.Approval && (pending ? b.ResolvedAt == null : b.ResolvedAt != null))
            .OrderByDescending(b => b.CreatedAt)
            .Take(500)
            .ToListAsync(ct);

        var runIds = bookmarks.Select(b => b.RunId).Distinct().ToList();
        var workflowIds = await db.WorkflowRuns.AsNoTracking()
            .Where(r => runIds.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, r => r.DefinitionId, ct);
        var names = await WorkflowNamesAsync(workflowIds.Values, ct);

        return bookmarks.Select(b =>
        {
            var payload = FlowPilotJson.ParseObject(b.PayloadJson);
            var workflowId = workflowIds.GetValueOrDefault(b.RunId);
            return new ApprovalDto(
                b.Id, b.RunId, workflowId, names.GetValueOrDefault(workflowId) ?? "(deleted workflow)", b.NodeId,
                Text(payload["title"]), Text(payload["description"]), Text(payload["assignee"]),
                b.CreatedAt, b.ResolvedAt, FlowPilotJson.ParseNode(b.ResolutionJson));
        }).ToList();
    }

    public async Task<StatsDto> StatsAsync(CancellationToken ct = default)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var dayAgo = now.AddDays(-1);
        var weekStart = now.Date.AddDays(-6);

        var workflows = await db.WorkflowDefinitions.CountAsync(ct);
        var runs24h = await db.WorkflowRuns.CountAsync(r => r.CreatedAt >= dayAgo, ct);
        var failed24h = await db.WorkflowRuns.CountAsync(r => r.CreatedAt >= dayAgo && r.Status == RunStatus.Failed, ct);
        var pendingApprovals = await db.Bookmarks.CountAsync(b => b.Kind == BookmarkKind.Approval && b.ResolvedAt == null, ct);

        var recent = await db.WorkflowRuns.AsNoTracking()
            .Where(r => r.CreatedAt >= weekStart && (r.Status == RunStatus.Completed || r.Status == RunStatus.Failed))
            .Select(r => new { r.CreatedAt, r.Status })
            .ToListAsync(ct);

        var byDay = Enumerable.Range(0, 7).Select(offset =>
        {
            var day = weekStart.AddDays(offset);
            var runs = recent.Where(r => r.CreatedAt.Date == day).ToList();
            return new DailyRunCount(day.ToString("yyyy-MM-dd"),
                runs.Count(r => r.Status == RunStatus.Completed),
                runs.Count(r => r.Status == RunStatus.Failed));
        }).ToList();

        return new StatsDto(workflows, runs24h, failed24h, pendingApprovals, byDay);
    }

    private async Task<Dictionary<Guid, string>> WorkflowNamesAsync(IEnumerable<Guid> ids, CancellationToken ct)
    {
        var distinct = ids.Distinct().ToList();
        return await db.WorkflowDefinitions.AsNoTracking()
            .Where(d => distinct.Contains(d.Id))
            .ToDictionaryAsync(d => d.Id, d => d.Name, ct);
    }

    private static string? Text(System.Text.Json.Nodes.JsonNode? node) => node is null ? null : FlowPilotJson.AsText(node);
}
