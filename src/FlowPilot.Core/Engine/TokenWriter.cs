using System.Text.Json.Nodes;
using FlowPilot.Core.Activities;
using FlowPilot.Core.Persistence;

namespace FlowPilot.Core.Engine;

/// <summary>Turns a node outcome into tokens (work items) for its successors, inside the commit transaction.</summary>
internal sealed class TokenWriter(FlowPilotDbContext db, WorkflowGraph graph, RunState state, Guid runId, DateTime now)
{
    public int Added { get; private set; }

    public void Route(string nodeId, string outcome, JsonNode? output)
    {
        foreach (var edge in graph.Outgoing(nodeId, outcome))
        {
            var target = graph.FindNode(edge.Target);
            if (target is null) continue;

            if (target.Type == WorkflowGraph.JoinType)
                ArriveAtJoin(target.Id, edge.Id, nodeId, FlowPilotJson.AsText(target.Config["mode"]), output);
            else
                Add(new WorkItemEntity { NodeId = target.Id, InputJson = FlowPilotJson.ToJson(output) });
        }
    }

    public void Add(WorkItemEntity item)
    {
        item.Id = Guid.NewGuid();
        item.RunId = runId;
        item.CreatedAt = now;
        if (item.AvailableAt == default) item.AvailableAt = now;
        db.WorkItems.Add(item);
        Added++;
    }

    /// <summary>
    /// Join bookkeeping lives in the join node's state: arrivals are keyed by edge id.
    /// 'all' fires once every incoming edge has delivered; 'any' fires on the first and drops the rest
    /// until every edge has delivered, then resets so the join can be used again inside a loop.
    /// </summary>
    private void ArriveAtJoin(string joinId, string edgeId, string sourceNodeId, string mode, JsonNode? output)
    {
        var joinState = state.StateOf(joinId);
        var arrivals = joinState["arrivals"] as JsonObject ?? [];
        arrivals[edgeId] = new JsonObject { ["source"] = sourceNodeId, ["output"] = output.Clone() };
        joinState["arrivals"] = arrivals.DeepClone();

        var complete = graph.Incoming(joinId).All(e => arrivals.ContainsKey(e.Id));

        if (mode == JoinActivity.ModeAny)
        {
            if (joinState["fired"]?.GetValue<bool>() != true)
            {
                Add(new WorkItemEntity { NodeId = joinId, InputJson = new JsonObject { [sourceNodeId] = output.Clone() }.ToJsonString() });
                joinState["fired"] = true;
            }
        }
        else if (complete)
        {
            var merged = new JsonObject();
            foreach (var (_, arrival) in arrivals)
                merged[arrival!["source"]!.GetValue<string>()] = arrival["output"].Clone();
            Add(new WorkItemEntity { NodeId = joinId, InputJson = merged.ToJsonString() });
        }

        state.SetState(joinId, complete ? [] : joinState);
    }
}
