using Microsoft.EntityFrameworkCore;

namespace FlowPilot.Core.Persistence;

internal static class DbContextExtensions
{
    private const int MaxConcurrencyAttempts = 10;

    /// <summary>
    /// Runs <paramref name="work"/> and saves it in one transaction. Runs carry an optimistic concurrency token,
    /// so when two branches of the same run commit at once the loser starts over from fresh data.
    /// </summary>
    public static async Task<T> InTransactionAsync<T>(this FlowPilotDbContext db, Func<Task<T>> work, CancellationToken cancellationToken)
    {
        for (var attempt = 1; ; attempt++)
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            try
            {
                var result = await work();
                await db.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return result;
            }
            catch (DbUpdateConcurrencyException) when (attempt < MaxConcurrencyAttempts)
            {
                await transaction.RollbackAsync(cancellationToken);
                await Task.Delay(Random.Shared.Next(5, 25 * attempt), cancellationToken);
            }
        }
    }
}
