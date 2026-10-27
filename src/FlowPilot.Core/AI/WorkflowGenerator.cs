using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FlowPilot.Abstractions;
using FlowPilot.Core.Activities;
using FlowPilot.Core.Contracts;
using FlowPilot.Core.Engine;

namespace FlowPilot.Core.AI;

public sealed record GenerateResult(WorkflowDefinition Definition, string Explanation);

/// <summary>Turns a natural-language request into a validated workflow definition (SPEC §6).</summary>
public sealed class WorkflowGenerator(ILlmClient llm, ActivityRegistry registry, WorkflowValidator validator)
{
    public async Task<GenerateResult> GenerateAsync(string prompt, WorkflowDefinition? current, CancellationToken ct)
    {
        var system = BuildSystemPrompt();
        var request = BuildUserPrompt(prompt, current);

        var (definition, explanation) = await AskAsync(system, request, ct);
        var validation = validator.Validate(definition);
        if (!validation.Valid)
        {
            var retry = request + "\n\nYour previous answer was invalid:\n"
                + string.Join("\n", validation.Errors.Select(e => $"- {e.Message}{(e.NodeId is null ? "" : $" (node {e.NodeId})")}"))
                + "\n\nReturn the corrected JSON object.";
            (definition, explanation) = await AskAsync(system, retry, ct);
            validation = validator.Validate(definition);
            if (!validation.Valid)
                explanation += "\n\nRemaining issues: " + string.Join("; ", validation.Errors.Select(e => e.Message));
        }

        if (current is not null && current.Id != Guid.Empty) definition.Id = current.Id;
        AutoLayout.Apply(definition);
        return new GenerateResult(definition, explanation);
    }

    private async Task<(WorkflowDefinition Definition, string Explanation)> AskAsync(string system, string prompt, CancellationToken ct)
    {
        var text = await llm.CompleteAsync(new LlmRequest(prompt, system), ct);
        var json = JsonExtraction.TryParse(text) as JsonObject
            ?? throw new LlmException("The model did not return a JSON object.");

        var definitionNode = json["definition"] as JsonObject ?? json;
        try
        {
            var definition = definitionNode.Deserialize<WorkflowDefinition>(FlowPilotJson.Options)
                ?? throw new LlmException("The model returned an empty definition.");
            return (definition, FlowPilotJson.AsText(json["explanation"]));
        }
        catch (JsonException ex)
        {
            throw new LlmException($"The model returned a malformed definition: {ex.Message}");
        }
    }

    private string BuildSystemPrompt()
    {
        var activities = registry.Descriptors.Select(d => new
        {
            d.Type,
            d.Description,
            outcomes = d.DynamicOutcomes ? ["<case names>", "default"] : d.Outcomes,
            inputs = d.Inputs.Select(i => new { i.Name, kind = i.Kind.ToString(), i.Required, i.Options, i.Description }),
        });

        return $$$"""
            You design workflows for FlowPilot, a visual workflow automation engine.
            Reply with a single JSON object and nothing else:
            { "definition": <WorkflowDefinition>, "explanation": "<one short paragraph for the user>" }

            WorkflowDefinition schema (camelCase):
            { "schemaVersion": "1", "name": string, "description": string, "variables": object,
              "nodes": [{ "id": string, "type": string, "name": string, "config": object,
                          "retry": { "maxAttempts", "initialDelayMs", "backoffMultiplier", "maxDelayMs" } | null,
                          "timeoutMs": number | null }],
              "edges": [{ "id": string, "source": nodeId, "sourceHandle": outcome, "target": nodeId }] }

            Rules:
            - Exactly one trigger node (type starting with "trigger.") starts the run. Use trigger.manual unless the user implies a webhook, schedule or event.
            - An edge leaves a node through one of its outcomes (sourceHandle). Several edges on one outcome run branches in parallel; use flow.join to wait for them.
            - Every node may also have an "error" outcome, taken after retries are exhausted.
            - Loops are explicit: loop.forEach emits "item" per element; the last node of the body must connect back to the forEach node. "done" fires when finished.
            - String config values may contain {{ js }} templates. Scope: input (previous node output), vars, nodes.<id>.output, trigger, run, item, index.
              A value that is exactly "{{ expr }}" keeps the JS type. Inputs of kind Expression or Code are raw JavaScript without braces.
            - Use short, readable, unique ids like "fetchOrder" and "e1". Fill every required input. Do not include positions.

            Available activities:
            {{{JsonSerializer.Serialize(activities, FlowPilotJson.Options)}}}
            """;
    }

    private static string BuildUserPrompt(string prompt, WorkflowDefinition? current)
    {
        var builder = new StringBuilder();
        if (current is not null && current.Nodes.Count > 0)
        {
            builder.AppendLine("Current workflow (modify it according to the request and return the full updated definition):");
            builder.AppendLine(FlowPilotJson.Serialize(current));
            builder.AppendLine();
        }
        builder.Append("Request: ").Append(prompt);
        return builder.ToString();
    }
}

/// <summary>Simple left-to-right layered layout: a node's column is its longest distance from a trigger, ignoring loop back-edges.</summary>
public static class AutoLayout
{
    private const double ColumnWidth = 340;
    private const double RowHeight = 180;

    public static void Apply(WorkflowDefinition definition)
    {
        var layers = definition.Nodes.ToDictionary(n => n.Id, _ => 0);
        var outgoing = definition.Edges.ToLookup(e => e.Source);

        foreach (var root in definition.Nodes.Where(n => n.Type.StartsWith("trigger.", StringComparison.Ordinal)))
            Visit(root.Id, 0, []);

        foreach (var column in definition.Nodes.GroupBy(n => layers[n.Id]))
        {
            var row = 0;
            foreach (var node in column)
                node.Position = new Position { X = column.Key * ColumnWidth, Y = row++ * RowHeight };
        }

        void Visit(string id, int depth, HashSet<string> path)
        {
            if (!layers.ContainsKey(id) || path.Contains(id)) return; // back-edge of a loop
            if (depth < layers[id] && path.Count > 0) return;
            layers[id] = Math.Max(layers[id], depth);
            path.Add(id);
            foreach (var edge in outgoing[id]) Visit(edge.Target, depth + 1, path);
            path.Remove(id);
        }
    }
}
