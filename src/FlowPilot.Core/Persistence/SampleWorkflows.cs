using FlowPilot.Abstractions;

namespace FlowPilot.Core.Persistence;

/// <summary>Example workflows seeded into an empty database so a fresh install has something to run.</summary>
public static class SampleWorkflows
{
    public static IEnumerable<WorkflowDefinition> All() => [BigOrderAlert(), OrderLineTotals(), ExpenseApproval()];

    /// <summary>Webhook → condition → HTTP call with retries, falling back to a log on the error edge.</summary>
    public static WorkflowDefinition BigOrderAlert() => FlowPilotJson.ParseDefinition("""
        {
          "name": "Big order alert",
          "description": "POST /hooks/orders with { \"id\": 42, \"total\": 250 }. Orders over 100 are forwarded to an HTTP endpoint.",
          "nodes": [
            { "id": "webhook", "type": "trigger.webhook", "name": "Order webhook",
              "config": { "path": "orders", "method": "POST" }, "position": { "x": 0, "y": 80 } },
            { "id": "check", "type": "condition", "name": "Total over 100?",
              "config": { "expression": "input.body.total > 100" }, "position": { "x": 340, "y": 80 } },
            { "id": "notify", "type": "http.request", "name": "Notify sales",
              "config": {
                "url": "https://httpbin.org/post",
                "method": "POST",
                "headers": { "X-Source": "FlowPilot" },
                "body": "{{ ({ text: 'Big order ' + input.body.id, total: input.body.total }) }}",
                "timeoutMs": 10000
              },
              "retry": { "maxAttempts": 3, "initialDelayMs": 1000, "backoffMultiplier": 2, "maxDelayMs": 10000 },
              "position": { "x": 680, "y": -20 } },
            { "id": "notified", "type": "log", "name": "Log success",
              "config": { "message": "Order {{ trigger.body.id }} forwarded (HTTP {{ input.status }})", "level": "info" },
              "position": { "x": 1020, "y": -80 } },
            { "id": "notifyFailed", "type": "log", "name": "Log failure",
              "config": { "message": "Could not forward order {{ trigger.body.id }}: {{ input.error }}", "level": "warning" },
              "position": { "x": 1020, "y": 80 } },
            { "id": "small", "type": "log", "name": "Small order",
              "config": { "message": "Order {{ input.body.id }} ({{ input.body.total }}) is below the threshold", "level": "info" },
              "position": { "x": 680, "y": 220 } }
          ],
          "edges": [
            { "id": "e1", "source": "webhook", "sourceHandle": "done", "target": "check" },
            { "id": "e2", "source": "check", "sourceHandle": "true", "target": "notify" },
            { "id": "e3", "source": "check", "sourceHandle": "false", "target": "small" },
            { "id": "e4", "source": "notify", "sourceHandle": "done", "target": "notified" },
            { "id": "e5", "source": "notify", "sourceHandle": "error", "target": "notifyFailed" }
          ]
        }
        """);

    /// <summary>forEach over order lines; a script computes each line and variable.set accumulates the total.</summary>
    public static WorkflowDefinition OrderLineTotals() => FlowPilotJson.ParseDefinition("""
        {
          "name": "Order line totals",
          "description": "Loops over order lines (input.items, or a built-in sample) and sums them with a script.",
          "variables": { "total": 0 },
          "nodes": [
            { "id": "start", "type": "trigger.manual", "name": "Start", "config": {}, "position": { "x": 0, "y": 0 } },
            { "id": "each", "type": "loop.forEach", "name": "Each line",
              "config": { "items": "trigger?.items ?? [{ sku: 'A-1', price: 4.5, qty: 2 }, { sku: 'B-7', price: 12, qty: 1 }, { sku: 'C-3', price: 0.99, qty: 10 }]" },
              "position": { "x": 340, "y": 0 } },
            { "id": "lineTotal", "type": "script", "name": "Line total",
              "config": { "code": "const line = item.price * item.qty;\nreturn { sku: item.sku, line: Math.round(line * 100) / 100 };" },
              "position": { "x": 680, "y": -120 } },
            { "id": "accumulate", "type": "variable.set", "name": "Add to total",
              "config": { "name": "total", "value": "{{ Math.round((vars.total + input.line) * 100) / 100 }}" },
              "position": { "x": 1020, "y": -120 } },
            { "id": "summary", "type": "log", "name": "Summary",
              "config": { "message": "{{ input.count }} lines, order total {{ vars.total }}", "level": "info" },
              "position": { "x": 680, "y": 140 } }
          ],
          "edges": [
            { "id": "e1", "source": "start", "sourceHandle": "done", "target": "each" },
            { "id": "e2", "source": "each", "sourceHandle": "item", "target": "lineTotal" },
            { "id": "e3", "source": "lineTotal", "sourceHandle": "done", "target": "accumulate" },
            { "id": "e4", "source": "accumulate", "sourceHandle": "done", "target": "each" },
            { "id": "e5", "source": "each", "sourceHandle": "done", "target": "summary" }
          ]
        }
        """);

    /// <summary>Two parallel checks joined before a human approval with approved/rejected branches.</summary>
    public static WorkflowDefinition ExpenseApproval() => FlowPilotJson.ParseDefinition("""
        {
          "name": "Expense approval",
          "description": "Runs a risk check and a budget lookup in parallel, then waits for a manager's decision.",
          "nodes": [
            { "id": "start", "type": "trigger.manual", "name": "Expense submitted",
              "config": { "inputSchema": { "type": "object", "properties": { "amount": { "type": "number" }, "department": { "type": "string" } } } },
              "position": { "x": 0, "y": 80 } },
            { "id": "fanOut", "type": "flow.parallel", "name": "Run checks", "config": {}, "position": { "x": 340, "y": 80 } },
            { "id": "risk", "type": "script", "name": "Risk score",
              "config": { "code": "const amount = trigger?.amount ?? 250;\nreturn { amount, level: amount > 1000 ? 'high' : 'low' };" },
              "position": { "x": 680, "y": -20 } },
            { "id": "budget", "type": "script", "name": "Budget lookup",
              "config": { "code": "return { department: trigger?.department ?? 'Engineering', remaining: 5000 };" },
              "position": { "x": 680, "y": 180 } },
            { "id": "join", "type": "flow.join", "name": "Both checks done", "config": { "mode": "all" }, "position": { "x": 1020, "y": 80 } },
            { "id": "approve", "type": "approval", "name": "Manager approval",
              "config": {
                "title": "Approve expense of {{ input.risk.amount }}",
                "description": "Risk: {{ input.risk.level }}. {{ input.budget.department }} has {{ input.budget.remaining }} left.",
                "assignee": "manager@example.com"
              },
              "position": { "x": 1360, "y": 60 } },
            { "id": "approved", "type": "log", "name": "Approved",
              "config": { "message": "Expense approved{{ input.comment ? ': ' + input.comment : '' }}", "level": "info" },
              "position": { "x": 1700, "y": -20 } },
            { "id": "rejected", "type": "log", "name": "Rejected",
              "config": { "message": "Expense rejected{{ input.comment ? ': ' + input.comment : '' }}", "level": "warning" },
              "position": { "x": 1700, "y": 180 } }
          ],
          "edges": [
            { "id": "e1", "source": "start", "sourceHandle": "done", "target": "fanOut" },
            { "id": "e2", "source": "fanOut", "sourceHandle": "done", "target": "risk" },
            { "id": "e3", "source": "fanOut", "sourceHandle": "done", "target": "budget" },
            { "id": "e4", "source": "risk", "sourceHandle": "done", "target": "join" },
            { "id": "e5", "source": "budget", "sourceHandle": "done", "target": "join" },
            { "id": "e6", "source": "join", "sourceHandle": "done", "target": "approve" },
            { "id": "e7", "source": "approve", "sourceHandle": "approved", "target": "approved" },
            { "id": "e8", "source": "approve", "sourceHandle": "rejected", "target": "rejected" }
          ]
        }
        """);
}
