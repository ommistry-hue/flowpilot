using System.Reflection;
using Xunit.Sdk;

namespace FlowPilot.Tests.Infrastructure;

/// <summary>Runs an engine theory against SQLite.</summary>
public sealed class SqliteAttribute : DataAttribute
{
    public override IEnumerable<object[]> GetData(MethodInfo testMethod) => [["sqlite"]];
}

/// <summary>
/// Runs an engine theory against PostgreSQL when <c>FLOWPILOT_TEST_POSTGRES</c> holds a connection string
/// (each test creates and drops its own database); reported as skipped otherwise.
/// </summary>
public sealed class PostgresAttribute : DataAttribute
{
    public PostgresAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(EngineHarness.PostgresVariable)))
            Skip = $"Set {EngineHarness.PostgresVariable} to a PostgreSQL connection string to run.";
    }

    public override IEnumerable<object[]> GetData(MethodInfo testMethod) => [["postgres"]];
}
