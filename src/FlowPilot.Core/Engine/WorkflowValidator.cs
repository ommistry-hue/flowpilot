using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core.Activities;
using FlowPilot.Core.Contracts;

namespace FlowPilot.Core.Engine;

public sealed class WorkflowValidator(ActivityRegistry registry)
{
    public ValidationResult Validate(WorkflowDefinition definition)
    {
        var errors = new List<ValidationError>();
        var nodes = new Dictionary<string, NodeDefinition>();

        foreach (var node in definition.Nodes)
        {
            if (string.IsNullOrWhiteSpace(node.Id))
            {
                errors.Add(new("A node has an empty id."));
                continue;
            }
            if (!nodes.TryAdd(node.Id, node))
            {
                errors.Add(new($"Duplicate node id '{node.Id}'.", node.Id));
                continue;
            }

            var registration = registry.Find(node.Type);
            if (registration is null)
            {
                errors.Add(new($"Unknown activity type '{node.Type}'.", node.Id));
                continue;
            }

            foreach (var input in registration.Descriptor.Inputs.Where(i => i.Required && i.DefaultValue is null))
                if (IsEmpty(node.Config[input.Name]))
                    errors.Add(new($"'{input.DisplayName}' is required.", node.Id));
        }

        if (!definition.Nodes.Any(n => registry.Find(n.Type)?.Descriptor.IsTrigger == true))
            errors.Add(new("The workflow needs a trigger node."));

        var edgeIds = new HashSet<string>();
        foreach (var edge in definition.Edges)
        {
            if (!edgeIds.Add(edge.Id))
                errors.Add(new($"Duplicate edge id '{edge.Id}'.", EdgeId: edge.Id));

            if (!nodes.TryGetValue(edge.Source, out var source))
                errors.Add(new($"Edge source '{edge.Source}' does not exist.", EdgeId: edge.Id));
            else if (registry.Find(source.Type) is not null && !AllowedHandles(source).Contains(edge.SourceHandle))
                errors.Add(new($"Node '{source.Id}' has no outcome '{edge.SourceHandle}'.", source.Id, edge.Id));

            if (!nodes.TryGetValue(edge.Target, out var target))
                errors.Add(new($"Edge target '{edge.Target}' does not exist.", EdgeId: edge.Id));
            else if (registry.Find(target.Type)?.Descriptor.IsTrigger == true)
                errors.Add(new($"Trigger '{target.Id}' cannot have incoming edges.", target.Id, edge.Id));
        }

        foreach (var cycle in FindCyclesWithoutForEach(definition, nodes))
            errors.Add(new($"Cycle {string.Join(" → ", cycle)} must pass through a loop.forEach node.", cycle[0]));

        return new ValidationResult(errors.Count == 0, errors);
    }

    private HashSet<string> AllowedHandles(NodeDefinition node)
    {
        var descriptor = registry.Find(node.Type)?.Descriptor;
        var handles = new HashSet<string>(descriptor?.Outcomes ?? []) { Outcomes.Error };
        // Dynamic outcomes are named by the node's config; by convention a 'cases' array of { name }.
        if (descriptor?.DynamicOutcomes == true && node.Config["cases"] is JsonArray cases)
            foreach (var @case in cases.OfType<JsonObject>())
                if (FlowPilotJson.AsText(@case["name"]) is { Length: > 0 } name)
                    handles.Add(name);
        return handles;
    }

    /// <summary>Loops must be explicit: any cycle among non-forEach nodes is an error (Tarjan's SCC).</summary>
    private static List<List<string>> FindCyclesWithoutForEach(WorkflowDefinition definition, Dictionary<string, NodeDefinition> nodes)
    {
        bool IsPlain(string id) => nodes.TryGetValue(id, out var n) && n.Type != WorkflowGraph.ForEachType;

        var successors = definition.Edges
            .Where(e => IsPlain(e.Source) && IsPlain(e.Target))
            .ToLookup(e => e.Source, e => e.Target);

        var index = 0;
        var indices = new Dictionary<string, int>();
        var lowLinks = new Dictionary<string, int>();
        var stack = new Stack<string>();
        var onStack = new HashSet<string>();
        var cycles = new List<List<string>>();

        void Visit(string v)
        {
            indices[v] = lowLinks[v] = index++;
            stack.Push(v);
            onStack.Add(v);

            foreach (var w in successors[v])
            {
                if (!indices.ContainsKey(w))
                {
                    Visit(w);
                    lowLinks[v] = Math.Min(lowLinks[v], lowLinks[w]);
                }
                else if (onStack.Contains(w))
                {
                    lowLinks[v] = Math.Min(lowLinks[v], indices[w]);
                }
            }

            if (lowLinks[v] != indices[v]) return;
            var component = new List<string>();
            string member;
            do
            {
                member = stack.Pop();
                onStack.Remove(member);
                component.Add(member);
            }
            while (member != v);

            if (component.Count > 1 || successors[v].Contains(v))
            {
                component.Reverse();
                cycles.Add(component);
            }
        }

        foreach (var id in nodes.Keys.Where(IsPlain))
            if (!indices.ContainsKey(id))
                Visit(id);
        return cycles;
    }

    private static bool IsEmpty(JsonNode? value) => value switch
    {
        null => true,
        JsonValue v when v.TryGetValue<string>(out var s) => string.IsNullOrWhiteSpace(s),
        JsonArray a => a.Count == 0,
        _ => false,
    };
}
