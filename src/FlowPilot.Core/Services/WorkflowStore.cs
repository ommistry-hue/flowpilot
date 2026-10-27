using FlowPilot.Abstractions;
using FlowPilot.Core.Contracts;
using FlowPilot.Core.Engine;
using FlowPilot.Core.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FlowPilot.Core.Services;

public sealed record PublishResult(int? Version, ValidationResult Validation);

/// <summary>Draft and published workflow definitions.</summary>
public sealed class WorkflowStore(FlowPilotDbContext db, WorkflowValidator validator, TimeProvider clock)
{
    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    public async Task<IReadOnlyList<WorkflowSummary>> ListAsync(CancellationToken ct = default)
    {
        var entities = await db.WorkflowDefinitions.AsNoTracking().OrderByDescending(d => d.UpdatedAt).ToListAsync(ct);
        return entities.Select(e => DtoMapper.ToSummary(e, FlowPilotJson.ParseDefinition(e.DraftJson))).ToList();
    }

    public async Task<WorkflowDetail?> GetAsync(Guid id, CancellationToken ct = default)
    {
        var entity = await db.WorkflowDefinitions.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id, ct);
        return entity is null ? null : DtoMapper.ToDetail(entity, FlowPilotJson.ParseDefinition(entity.DraftJson));
    }

    public async Task<WorkflowDetail> CreateAsync(WorkflowDefinition definition, CancellationToken ct = default)
    {
        if (definition.Id == Guid.Empty || await db.WorkflowDefinitions.AnyAsync(d => d.Id == definition.Id, ct))
            definition.Id = Guid.NewGuid();

        var now = Now;
        var entity = new WorkflowDefinitionEntity { Id = definition.Id, CreatedAt = now };
        Apply(entity, definition, now);
        db.WorkflowDefinitions.Add(entity);
        await db.SaveChangesAsync(ct);
        return DtoMapper.ToDetail(entity, definition);
    }

    public async Task<WorkflowDetail?> UpdateAsync(Guid id, WorkflowDefinition definition, CancellationToken ct = default)
    {
        var entity = await db.WorkflowDefinitions.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (entity is null) return null;

        definition.Id = id;
        Apply(entity, definition, Now);
        await db.SaveChangesAsync(ct);
        return DtoMapper.ToDetail(entity, definition);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var runIds = db.WorkflowRuns.Where(r => r.DefinitionId == id).Select(r => r.Id);
        await db.WorkItems.Where(w => runIds.Contains(w.RunId)).ExecuteDeleteAsync(ct);
        await db.Bookmarks.Where(b => runIds.Contains(b.RunId)).ExecuteDeleteAsync(ct);
        await db.NodeExecutions.Where(e => runIds.Contains(e.RunId)).ExecuteDeleteAsync(ct);
        await db.WorkflowRuns.Where(r => r.DefinitionId == id).ExecuteDeleteAsync(ct);
        await db.ScheduleStates.Where(s => s.DefinitionId == id).ExecuteDeleteAsync(ct);
        await db.WorkflowVersions.Where(v => v.DefinitionId == id).ExecuteDeleteAsync(ct);
        var deleted = await db.WorkflowDefinitions.Where(d => d.Id == id).ExecuteDeleteAsync(ct);
        await transaction.CommitAsync(ct);
        return deleted > 0;
    }

    /// <summary>Validates the draft and freezes it as the next immutable version. Returns null when the workflow doesn't exist.</summary>
    public async Task<PublishResult?> PublishAsync(Guid id, CancellationToken ct = default)
    {
        var entity = await db.WorkflowDefinitions.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (entity is null) return null;

        var definition = FlowPilotJson.ParseDefinition(entity.DraftJson);
        var validation = validator.Validate(definition);
        if (!validation.Valid) return new PublishResult(null, validation);

        var version = (await db.WorkflowVersions.Where(v => v.DefinitionId == id).MaxAsync(v => (int?)v.Version, ct) ?? 0) + 1;
        var now = Now;
        db.WorkflowVersions.Add(new WorkflowVersionEntity
        {
            Id = Guid.NewGuid(),
            DefinitionId = id,
            Version = version,
            Json = entity.DraftJson,
            CreatedAt = now,
        });
        entity.PublishedVersion = version;
        entity.UpdatedAt = now;

        // Schedules may have changed; the cron scheduler recomputes the next fire time.
        await db.ScheduleStates.Where(s => s.DefinitionId == id).ExecuteDeleteAsync(ct);
        await db.SaveChangesAsync(ct);
        return new PublishResult(version, validation);
    }

    public async Task<IReadOnlyList<WorkflowVersionDto>?> VersionsAsync(Guid id, CancellationToken ct = default)
    {
        if (!await db.WorkflowDefinitions.AnyAsync(d => d.Id == id, ct)) return null;
        return await db.WorkflowVersions.AsNoTracking()
            .Where(v => v.DefinitionId == id)
            .OrderByDescending(v => v.Version)
            .Select(v => new WorkflowVersionDto(v.Version, v.CreatedAt))
            .ToListAsync(ct);
    }

    private static void Apply(WorkflowDefinitionEntity entity, WorkflowDefinition definition, DateTime now)
    {
        entity.Name = string.IsNullOrWhiteSpace(definition.Name) ? "Untitled workflow" : definition.Name.Trim();
        entity.Description = definition.Description;
        entity.DraftJson = FlowPilotJson.Serialize(definition);
        entity.UpdatedAt = now;
    }
}
