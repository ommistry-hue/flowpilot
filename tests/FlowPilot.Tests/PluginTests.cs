using FlowPilot.Abstractions;
using FlowPilot.Core.Activities;
using FlowPilot.Core.Plugins;
using FlowPilot.Plugins.Sample;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlowPilot.Tests;

public sealed class PluginTests
{
    [Fact]
    public void Scanner_finds_every_attributed_activity_in_an_assembly()
    {
        var types = ActivityScanner.FindActivityTypes(typeof(TextTransformActivity).Assembly).ToList();

        Assert.Equal([typeof(RandomNumberActivity), typeof(TextTransformActivity)], types.OrderBy(t => t.Name));
    }

    [Fact]
    public void Descriptor_is_built_from_attributes_with_camel_case_inputs()
    {
        var descriptor = ActivityScanner.Describe(typeof(TextTransformActivity)).Descriptor;

        Assert.Equal("text.transform", descriptor.Type);
        Assert.Equal("Transform text", descriptor.DisplayName);
        Assert.Equal("Text", descriptor.Category);
        Assert.Equal([Outcomes.Done], descriptor.Outcomes);
        Assert.False(descriptor.IsTrigger);

        var mode = Assert.Single(descriptor.Inputs, i => i.Name == "mode");
        Assert.Equal(InputKind.Select, mode.Kind);
        Assert.Equal(["upper", "lower", "slug"], mode.Options!);
        Assert.Equal("upper", mode.DefaultValue);
        Assert.True(Assert.Single(descriptor.Inputs, i => i.Name == "text").Required);
    }

    [Fact]
    public void Built_in_flow_activities_declare_outcomes_and_raw_expression_inputs()
    {
        var registration = ActivityScanner.Describe(typeof(ConditionActivity));

        Assert.Equal([Outcomes.True, Outcomes.False], registration.Descriptor.Outcomes);
        Assert.Contains("expression", registration.RawKeys);
        Assert.True(ActivityScanner.Describe(typeof(SwitchActivity)).Descriptor.DynamicOutcomes);
    }

    [Fact]
    public void Loader_loads_plugin_folders_into_isolated_contexts_sharing_the_abstractions()
    {
        var root = Path.Combine(Path.GetTempPath(), $"flowpilot-plugins-{Guid.NewGuid():N}");
        var folder = Directory.CreateDirectory(Path.Combine(root, "FlowPilot.Plugins.Sample"));
        File.Copy(typeof(TextTransformActivity).Assembly.Location, Path.Combine(folder.FullName, "FlowPilot.Plugins.Sample.dll"));
        Directory.CreateDirectory(Path.Combine(root, "EmptyPlugin"));

        try
        {
            var types = PluginLoader.LoadActivityTypes(root, NullLogger.Instance);

            Assert.Equal(2, types.Count);
            Assert.All(types, t => Assert.True(typeof(IActivity).IsAssignableFrom(t)));
            Assert.All(types, t => Assert.NotSame(typeof(TextTransformActivity).Assembly, t.Assembly));
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); }
            catch (UnauthorizedAccessException) { } // the loaded assembly stays locked on Windows
        }
    }
}
