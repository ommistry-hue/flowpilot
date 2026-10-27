using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core.Contracts;
using FlowPilot.Core.Plugins;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FlowPilot.Core.Activities;

/// <summary>An activity type registered in code via <c>AddActivity&lt;T&gt;()</c>.</summary>
public sealed record ActivityTypeRegistration(Type Type);

public sealed record InputBinding(PropertyInfo Property, string Name, InputAttribute Attribute);

public sealed record ActivityRegistration(Type Type, ActivityDescriptor Descriptor, IReadOnlyList<InputBinding> Inputs)
{
    /// <summary>Config keys that hold raw JS and must not go through {{ }} templating.</summary>
    public IReadOnlySet<string> RawKeys { get; } = Inputs
        .Where(i => i.Attribute.Kind is InputKind.Expression or InputKind.Code)
        .Select(i => i.Name)
        .ToHashSet();
}

public sealed class ActivityRegistry
{
    private readonly Dictionary<string, ActivityRegistration> _byType = new(StringComparer.Ordinal);

    public ActivityRegistry(IEnumerable<ActivityTypeRegistration> registrations, IOptions<FlowPilotOptions> options, ILogger<ActivityRegistry> logger)
    {
        var pluginTypes = PluginLoader.LoadActivityTypes(options.Value.PluginsPath, logger);
        foreach (var type in registrations.Select(r => r.Type).Concat(pluginTypes))
        {
            var registration = ActivityScanner.Describe(type);
            if (!_byType.TryAdd(registration.Descriptor.Type, registration))
                logger.LogWarning("Activity type {Type} from {Clr} is already registered; skipping", registration.Descriptor.Type, type.FullName);
        }
        Descriptors = _byType.Values.Select(r => r.Descriptor).OrderBy(d => d.Category).ThenBy(d => d.DisplayName).ToList();
    }

    public IReadOnlyList<ActivityDescriptor> Descriptors { get; }

    public ActivityRegistration? Find(string type) => _byType.GetValueOrDefault(type);

    public IActivity Create(ActivityRegistration registration, IServiceProvider services, JsonObject config)
    {
        var activity = (IActivity)ActivatorUtilities.CreateInstance(services, registration.Type);
        foreach (var input in registration.Inputs)
        {
            var value = config[input.Name];
            if (value is not null)
                input.Property.SetValue(activity, ConvertInput(value, input.Property.PropertyType, input.Name));
            else if (input.Attribute.DefaultValue is { } defaultValue)
                input.Property.SetValue(activity, ConvertInput(JsonSerializer.SerializeToNode(defaultValue), input.Property.PropertyType, input.Name));
        }
        return activity;
    }

    private static object? ConvertInput(JsonNode? value, Type targetType, string name)
    {
        if (typeof(JsonNode).IsAssignableFrom(targetType)) return value.Clone();
        if (targetType == typeof(string)) return FlowPilotJson.AsText(value);

        try
        {
            return value.Deserialize(targetType, FlowPilotJson.Options);
        }
        catch (JsonException) when (value is JsonValue v && v.TryGetValue<string>(out var text))
        {
            var underlying = Nullable.GetUnderlyingType(targetType) ?? targetType;
            if (string.IsNullOrWhiteSpace(text)) return null;
            try { return Convert.ChangeType(text, underlying, System.Globalization.CultureInfo.InvariantCulture); }
            catch (FormatException) { throw new InvalidOperationException($"Input '{name}' expects {underlying.Name} but got '{text}'."); }
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException($"Input '{name}' is not a valid {targetType.Name}: {ex.Message}");
        }
    }
}

public static class ActivityScanner
{
    public static IEnumerable<Type> FindActivityTypes(Assembly assembly)
    {
        Type?[] types;
        try { types = assembly.GetTypes(); }
        catch (ReflectionTypeLoadException ex) { types = ex.Types; }

        return types.OfType<Type>().Where(t =>
            t is { IsClass: true, IsAbstract: false }
            && typeof(IActivity).IsAssignableFrom(t)
            && t.GetCustomAttribute<ActivityAttribute>() is not null);
    }

    public static ActivityRegistration Describe(Type type)
    {
        var attribute = type.GetCustomAttribute<ActivityAttribute>()
            ?? throw new InvalidOperationException($"{type.FullName} has no [Activity] attribute.");

        var inputs = type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => p.CanWrite)
            .Select(p => (Property: p, Attribute: p.GetCustomAttribute<InputAttribute>()))
            .Where(x => x.Attribute is not null)
            .Select(x => new InputBinding(x.Property, JsonNamingPolicy.CamelCase.ConvertName(x.Property.Name), x.Attribute!))
            .ToList();

        var descriptor = new ActivityDescriptor(
            Type: attribute.Type,
            DisplayName: attribute.DisplayName ?? Humanize(type.Name.Replace("Activity", "")),
            Category: attribute.Category,
            Description: attribute.Description,
            Icon: attribute.Icon,
            Outcomes: attribute.Outcomes,
            DynamicOutcomes: attribute.DynamicOutcomes,
            IsTrigger: attribute.IsTrigger,
            Inputs: inputs.Select(i => new ActivityInputDescriptor(
                i.Name,
                i.Attribute.DisplayName ?? Humanize(i.Property.Name),
                i.Attribute.Description,
                i.Attribute.Kind,
                i.Attribute.Options,
                i.Attribute.Required,
                i.Attribute.DefaultValue)).ToList());

        return new ActivityRegistration(type, descriptor, inputs);
    }

    private static string Humanize(string pascal) =>
        string.Concat(pascal.Select((c, i) => i > 0 && char.IsUpper(c) && !char.IsUpper(pascal[i - 1]) ? " " + c : c.ToString()));
}
