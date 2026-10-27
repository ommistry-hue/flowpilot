using System.Text.Json.Nodes;
using FlowPilot.Core.Persistence;

namespace FlowPilot.Core.Engine;

/// <summary>Mutable view over the JSON columns of a run: variables, per-node state and node outputs.</summary>
internal sealed class RunState
{
    private RunState(JsonObject variables, JsonObject nodeState, JsonObject outputs)
    {
        Variables = variables;
        NodeState = nodeState;
        Outputs = outputs;
    }

    public JsonObject Variables { get; }
    public JsonObject NodeState { get; }
    public JsonObject Outputs { get; }

    public static RunState Load(WorkflowRunEntity run) => new(
        FlowPilotJson.ParseObject(run.VariablesJson),
        FlowPilotJson.ParseObject(run.NodeStateJson),
        FlowPilotJson.ParseObject(run.OutputsJson));

    public JsonObject StateOf(string nodeId) => NodeState[nodeId] as JsonObject ?? [];

    public void SetState(string nodeId, JsonObject state)
    {
        if (state.Count == 0) NodeState.Remove(nodeId);
        else NodeState[nodeId] = state.DeepClone();
    }

    /// <summary>Applies only the keys an activity changed, so parallel branches don't overwrite each other.</summary>
    public void MergeVariables(JsonObject before, JsonObject after)
    {
        foreach (var (key, value) in after)
            if (!before.TryGetPropertyValue(key, out var old) || !JsonNode.DeepEquals(old, value))
                Variables[key] = value?.DeepClone();

        foreach (var (key, _) in before)
            if (!after.ContainsKey(key))
                Variables.Remove(key);
    }

    public void SaveTo(WorkflowRunEntity run, SecretStore? secrets = null)
    {
        run.VariablesJson = (secrets?.MaskNode(Variables) ?? Variables).ToJsonString();
        run.NodeStateJson = NodeState.ToJsonString();
        run.OutputsJson = (secrets?.MaskNode(Outputs) ?? Outputs).ToJsonString();
        run.ConcurrencyToken = Guid.NewGuid();
    }
}
