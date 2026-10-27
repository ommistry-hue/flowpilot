using FlowPilot.Core.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FlowPilot.Tests;

/// <summary>Checks the PostgreSQL model offline (no server needed): generating DDL exercises the provider mappings.</summary>
public sealed class PostgresSchemaTests
{
    private static string CreateScript()
    {
        var options = new DbContextOptionsBuilder<FlowPilotDbContext>().UseNpgsql("Host=unused").Options;
        using var db = new FlowPilotDbContext(options);
        return db.Database.GenerateCreateScript();
    }

    [Fact]
    public void Tables_use_quoted_names_text_json_and_timestamptz()
    {
        var script = CreateScript();

        foreach (var table in new[] { "WorkflowDefinitions", "WorkflowVersions", "WorkflowRuns", "NodeExecutions", "WorkItems", "Bookmarks", "ScheduleStates" })
            Assert.Contains($"CREATE TABLE \"{table}\"", script);

        Assert.Contains("\"DefinitionSnapshotJson\" text NOT NULL", script);
        Assert.Contains("\"AvailableAt\" timestamp with time zone NOT NULL", script);
        Assert.Contains("\"LockedUntil\" timestamp with time zone", script);
        Assert.Contains("\"ConcurrencyToken\" uuid NOT NULL", script);
        Assert.Contains("\"Status\" character varying(20) NOT NULL", script);
        Assert.DoesNotContain("jsonb", script);
    }
}
