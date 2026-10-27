using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace FlowPilot.Core.Persistence;

public sealed class FlowPilotDbContext(DbContextOptions<FlowPilotDbContext> options) : DbContext(options)
{
    public DbSet<WorkflowDefinitionEntity> WorkflowDefinitions => Set<WorkflowDefinitionEntity>();
    public DbSet<WorkflowVersionEntity> WorkflowVersions => Set<WorkflowVersionEntity>();
    public DbSet<WorkflowRunEntity> WorkflowRuns => Set<WorkflowRunEntity>();
    public DbSet<NodeExecutionEntity> NodeExecutions => Set<NodeExecutionEntity>();
    public DbSet<WorkItemEntity> WorkItems => Set<WorkItemEntity>();
    public DbSet<BookmarkEntity> Bookmarks => Set<BookmarkEntity>();
    public DbSet<ScheduleStateEntity> ScheduleStates => Set<ScheduleStateEntity>();

    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        // All timestamps are UTC; SQLite loses DateTime.Kind, so restore it on read.
        builder.Properties<DateTime>().HaveConversion<UtcConverter>();
        builder.Properties<DateTime?>().HaveConversion<NullableUtcConverter>();
    }

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<WorkflowDefinitionEntity>(e =>
        {
            e.ToTable("WorkflowDefinitions");
            e.Property(x => x.Name).HasMaxLength(200);
        });

        model.Entity<WorkflowVersionEntity>(e =>
        {
            e.ToTable("WorkflowVersions");
            e.HasIndex(x => new { x.DefinitionId, x.Version }).IsUnique();
        });

        model.Entity<WorkflowRunEntity>(e =>
        {
            e.ToTable("WorkflowRuns");
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.ConcurrencyToken).IsConcurrencyToken();
            e.HasIndex(x => x.DefinitionId);
            e.HasIndex(x => x.CreatedAt);
            e.HasIndex(x => x.Status);
        });

        model.Entity<NodeExecutionEntity>(e =>
        {
            e.ToTable("NodeExecutions");
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.RunId);
        });

        model.Entity<WorkItemEntity>(e =>
        {
            e.ToTable("WorkItems");
            e.HasIndex(x => x.AvailableAt);
            e.HasIndex(x => x.RunId);
        });

        model.Entity<BookmarkEntity>(e =>
        {
            e.ToTable("Bookmarks");
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.RunId);
            e.HasIndex(x => new { x.Kind, x.ResolvedAt });
        });

        model.Entity<ScheduleStateEntity>(e =>
        {
            e.ToTable("ScheduleStates");
            e.HasKey(x => new { x.DefinitionId, x.NodeId });
        });
    }

    private sealed class UtcConverter() : ValueConverter<DateTime, DateTime>(
        v => ToUtc(v),
        v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

    private sealed class NullableUtcConverter() : ValueConverter<DateTime?, DateTime?>(
        v => v.HasValue ? ToUtc(v.Value) : v,
        v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v);

    // Unspecified values are already UTC by convention; Npgsql only accepts Kind=Utc for timestamptz.
    private static DateTime ToUtc(DateTime value) =>
        value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : DateTime.SpecifyKind(value, DateTimeKind.Utc);
}
