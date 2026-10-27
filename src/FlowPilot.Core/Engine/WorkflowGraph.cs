using FlowPilot.Abstractions;

namespace FlowPilot.Core.Engine;

/// <summary>Read-only lookups over a workflow definition.</summary>
public sealed class WorkflowGraph
{
    public const string ForEachType = "loop.forEach";
    public const string JoinType = "flow.join";

    private readonly Dictionary<string, NodeDefinition> _nodes;
    private readonly ILookup<string, EdgeDefinition> _outgoing;
    private readonly ILookup<string, EdgeDefinition> _incoming;
    private readonly Lazy<Dictionary<string, string>> _loopScopes;

    public WorkflowGraph(WorkflowDefinition definition)
    {
        Definition = definition;
        _nodes = definition.Nodes.GroupBy(n => n.Id).ToDictionary(g => g.Key, g => g.First());
        _outgoing = definition.Edges.ToLookup(e => e.Source);
        _incoming = definition.Edges.ToLookup(e => e.Target);
        _loopScopes = new(BuildLoopScopes);
    }

    public WorkflowDefinition Definition { get; }

    public NodeDefinition? FindNode(string id) => _nodes.GetValueOrDefault(id);

    public IEnumerable<EdgeDefinition> Outgoing(string nodeId, string handle) =>
        _outgoing[nodeId].Where(e => string.Equals(e.SourceHandle, handle, StringComparison.Ordinal));

    public bool HasOutgoing(string nodeId, string handle) => Outgoing(nodeId, handle).Any();

    public IReadOnlyList<EdgeDefinition> Incoming(string nodeId) => _incoming[nodeId].ToList();

    /// <summary>The innermost forEach whose body contains <paramref name="nodeId"/>, used to expose item/index.</summary>
    public string? EnclosingLoop(string nodeId) => _loopScopes.Value.GetValueOrDefault(nodeId);

    /// <summary>
    /// A forEach body is everything reachable from its 'item' edges without passing back through it.
    /// When loops nest, the closest forEach (fewest hops) wins.
    /// </summary>
    private Dictionary<string, string> BuildLoopScopes()
    {
        var best = new Dictionary<string, (string Loop, int Distance)>();
        foreach (var loop in _nodes.Values.Where(n => n.Type == ForEachType))
        {
            var queue = new Queue<(string Node, int Distance)>(Outgoing(loop.Id, Outcomes.Item).Select(e => (e.Target, 1)));
            var seen = new HashSet<string> { loop.Id };
            while (queue.TryDequeue(out var current))
            {
                if (!seen.Add(current.Node)) continue;
                if (!best.TryGetValue(current.Node, out var existing) || current.Distance < existing.Distance)
                    best[current.Node] = (loop.Id, current.Distance);
                foreach (var edge in _outgoing[current.Node])
                    queue.Enqueue((edge.Target, current.Distance + 1));
            }
        }
        return best.ToDictionary(p => p.Key, p => p.Value.Loop);
    }
}
