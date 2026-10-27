using Microsoft.EntityFrameworkCore;

namespace FlowPilot.Core.Persistence;

/// <summary>Atomically leases due work items so that each one is processed by a single worker at a time.</summary>
public interface IWorkItemClaimer
{
    Task<IReadOnlyList<Guid>> ClaimAsync(FlowPilotDbContext db, string workerId, int batchSize, DateTime now, DateTime lockedUntil, CancellationToken ct);
}

public sealed class SqliteWorkItemClaimer : IWorkItemClaimer
{
    public async Task<IReadOnlyList<Guid>> ClaimAsync(FlowPilotDbContext db, string workerId, int batchSize, DateTime now, DateTime lockedUntil, CancellationToken ct) =>
        await db.Database.SqlQuery<Guid>($"""
            UPDATE WorkItems SET LockedBy = {workerId}, LockedUntil = {lockedUntil}
            WHERE Id IN (
                SELECT Id FROM WorkItems
                WHERE AvailableAt <= {now} AND (LockedUntil IS NULL OR LockedUntil < {now})
                ORDER BY AvailableAt
                LIMIT {batchSize})
            RETURNING Id AS Value
            """).ToListAsync(ct);
}

public sealed class PostgresWorkItemClaimer : IWorkItemClaimer
{
    public async Task<IReadOnlyList<Guid>> ClaimAsync(FlowPilotDbContext db, string workerId, int batchSize, DateTime now, DateTime lockedUntil, CancellationToken ct) =>
        await db.Database.SqlQuery<Guid>($"""
            UPDATE "WorkItems" SET "LockedBy" = {workerId}, "LockedUntil" = {lockedUntil}
            WHERE "Id" IN (
                SELECT "Id" FROM "WorkItems"
                WHERE "AvailableAt" <= {now} AND ("LockedUntil" IS NULL OR "LockedUntil" < {now})
                ORDER BY "AvailableAt"
                LIMIT {batchSize}
                FOR UPDATE SKIP LOCKED)
            RETURNING "Id" AS "Value"
            """).ToListAsync(ct);
}
