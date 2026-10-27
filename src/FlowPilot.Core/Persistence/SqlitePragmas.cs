using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace FlowPilot.Core.Persistence;

/// <summary>
/// Per-connection SQLite settings. In WAL mode, <c>synchronous=NORMAL</c> skips the fsync on every commit
/// (each node step commits several times) while keeping the database consistent; a power loss can only
/// drop the last few commits, which at-least-once execution re-runs anyway.
/// </summary>
public sealed class SqlitePragmas : DbConnectionInterceptor
{
    public static readonly SqlitePragmas Instance = new();

    private const string Pragmas = "PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=30000;";

    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    {
        using var command = connection.CreateCommand();
        command.CommandText = Pragmas;
        command.ExecuteNonQuery();
    }

    public override async Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = Pragmas;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
