using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace FlowPilot.Tests.Api;

public sealed class ApiTests(FlowPilotApp app) : IClassFixture<FlowPilotApp>
{
    private readonly HttpClient _client = app.CreateClient();

    private static readonly JsonObject LinearWorkflow = new()
    {
        ["name"] = "API test",
        ["nodes"] = new JsonArray(
            new JsonObject { ["id"] = "start", ["type"] = "trigger.manual" },
            new JsonObject { ["id"] = "greet", ["type"] = "log", ["config"] = new JsonObject { ["message"] = "Hello {{ input.name }}" } }),
        ["edges"] = new JsonArray(new JsonObject { ["id"] = "e1", ["source"] = "start", ["sourceHandle"] = "done", ["target"] = "greet" }),
    };

    private async Task<string> WorkflowIdAsync(string name)
    {
        var workflows = (await _client.GetFromJsonAsync<JsonArray>("/api/workflows"))!;
        return workflows.Single(w => w!["name"]!.GetValue<string>() == name)!["id"]!.GetValue<string>();
    }

    private async Task<string> StartRunAsync(string workflowId, JsonObject? input = null)
    {
        var response = await _client.PostAsJsonAsync($"/api/workflows/{workflowId}/run", new JsonObject { ["input"] = input });
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonObject>())!["runId"]!.GetValue<string>();
    }

    [Fact]
    public async Task Health_and_activity_catalog_are_served()
    {
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/health")).StatusCode);

        var activities = (await _client.GetFromJsonAsync<JsonArray>("/api/activities"))!;
        var condition = activities.Single(a => a!["type"]!.GetValue<string>() == "condition")!;
        Assert.Equal(17, activities.Count);
        Assert.Equal(["true", "false"], condition["outcomes"]!.AsArray().Select(o => o!.GetValue<string>()));
        Assert.Equal("Expression", condition["inputs"]![0]!["kind"]!.GetValue<string>());
    }

    [Fact]
    public async Task Workflow_crud_publish_and_run_to_completion()
    {
        var created = await _client.PostAsJsonAsync("/api/workflows", LinearWorkflow);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await created.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<string>();

        var renamed = LinearWorkflow.DeepClone().AsObject();
        renamed["name"] = "API test (renamed)";
        var updated = (await (await _client.PutAsJsonAsync($"/api/workflows/{id}", renamed)).Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.Equal("API test (renamed)", updated["name"]!.GetValue<string>());
        Assert.Equal(["trigger.manual"], updated["triggerTypes"]!.AsArray().Select(t => t!.GetValue<string>()));

        var published = await _client.PostAsync($"/api/workflows/{id}/publish", null);
        Assert.Equal(1, (await published.Content.ReadFromJsonAsync<JsonObject>())!["version"]!.GetValue<int>());
        var versions = (await _client.GetFromJsonAsync<JsonArray>($"/api/workflows/{id}/versions"))!;
        Assert.Equal(1, versions.Single()!["version"]!.GetValue<int>());

        var runId = await StartRunAsync(id, new JsonObject { ["name"] = "Ada" });
        var run = await FlowPilotApp.WaitForRunAsync(_client, runId, "Completed", "Failed");
        Assert.Equal("Completed", run["status"]!.GetValue<string>());
        Assert.Equal("Hello Ada", run["nodes"]!.AsArray().Last()!["output"]!["message"]!.GetValue<string>());

        var runs = (await _client.GetFromJsonAsync<JsonObject>($"/api/runs?workflowId={id}"))!;
        Assert.Equal(1, runs["total"]!.GetValue<int>());
        Assert.Equal("API test (renamed)", runs["items"]![0]!["workflowName"]!.GetValue<string>());

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/workflows/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/workflows/{id}")).StatusCode);
    }

    [Fact]
    public async Task Validate_and_publish_report_errors()
    {
        var invalid = new JsonObject
        {
            ["name"] = "Broken",
            ["nodes"] = new JsonArray(new JsonObject { ["id"] = "a", ["type"] = "condition" }),
            ["edges"] = new JsonArray(new JsonObject { ["id"] = "e1", ["source"] = "a", ["sourceHandle"] = "true", ["target"] = "ghost" }),
        };

        var result = (await (await _client.PostAsJsonAsync("/api/workflows/validate", invalid)).Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.False(result["valid"]!.GetValue<bool>());
        var messages = result["errors"]!.AsArray().Select(e => e!["message"]!.GetValue<string>()).ToList();
        Assert.Contains(messages, m => m.Contains("needs a trigger"));
        Assert.Contains(messages, m => m.Contains("'ghost' does not exist"));
        Assert.Contains(messages, m => m.Contains("'Condition' is required"));

        var created = (await (await _client.PostAsJsonAsync("/api/workflows", invalid)).Content.ReadFromJsonAsync<JsonObject>())!;
        var publish = await _client.PostAsync($"/api/workflows/{created["id"]}/publish", null);
        Assert.Equal(HttpStatusCode.BadRequest, publish.StatusCode);
    }

    [Fact]
    public async Task Webhook_starts_the_published_workflow_and_enforces_the_body_limit()
    {
        var response = await _client.PostAsJsonAsync("/hooks/orders", new { id = 5, total = 12 });
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var runId = (await response.Content.ReadFromJsonAsync<JsonObject>())!["runIds"]![0]!.GetValue<string>();

        var run = await FlowPilotApp.WaitForRunAsync(_client, runId, "Completed", "Failed");
        Assert.Equal("Completed", run["status"]!.GetValue<string>());
        Assert.Equal(12, run["input"]!["body"]!["total"]!.GetValue<int>());

        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/hooks/orders")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PostAsJsonAsync("/hooks/unknown", new { })).StatusCode);

        var oversized = new StringContent(new string('x', 5000), Encoding.UTF8, "text/plain");
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await _client.PostAsync("/hooks/orders", oversized)).StatusCode);
    }

    [Fact]
    public async Task Running_an_invalid_draft_returns_its_validation_errors()
    {
        var invalid = new JsonObject
        {
            ["name"] = "Unrunnable",
            ["nodes"] = new JsonArray(
                new JsonObject { ["id"] = "start", ["type"] = "trigger.manual" },
                new JsonObject { ["id"] = "check", ["type"] = "condition" }),
            ["edges"] = new JsonArray(new JsonObject { ["id"] = "e1", ["source"] = "start", ["target"] = "check" }),
        };
        var id = (await (await _client.PostAsJsonAsync("/api/workflows", invalid)).Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<string>();

        var response = await _client.PostAsJsonAsync($"/api/workflows/{id}/run", new { });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.False(body["valid"]!.GetValue<bool>());
        Assert.Equal("check", body["errors"]![0]!["nodeId"]!.GetValue<string>());
    }

    [Fact]
    public async Task Webhook_with_a_shared_secret_rejects_unauthenticated_calls()
    {
        var workflow = new JsonObject
        {
            ["name"] = "Secured hook",
            ["nodes"] = new JsonArray(new JsonObject
            {
                ["id"] = "hook", ["type"] = "trigger.webhook",
                ["config"] = new JsonObject { ["path"] = "secured", ["method"] = "POST", ["secret"] = "let-me-in" },
            }),
            ["edges"] = new JsonArray(),
        };
        var id = (await (await _client.PostAsJsonAsync("/api/workflows", workflow)).Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<string>();
        Assert.Equal(HttpStatusCode.OK, (await _client.PostAsync($"/api/workflows/{id}/publish", null)).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.PostAsJsonAsync("/hooks/secured", new { a = 1 })).StatusCode);

        using var request = new HttpRequestMessage(HttpMethod.Post, "/hooks/secured") { Content = JsonContent.Create(new { a = 1 }) };
        request.Headers.Add("X-FlowPilot-Secret", "let-me-in");
        var accepted = await _client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Accepted, accepted.StatusCode);

        var runId = (await accepted.Content.ReadFromJsonAsync<JsonObject>())!["runIds"]![0]!.GetValue<string>();
        var run = await FlowPilotApp.WaitForRunAsync(_client, runId, "Completed", "Failed");
        Assert.Null(run["input"]!["headers"]!["x-flowpilot-secret"]); // never stored
    }
    [Theory]
    [InlineData("approve", "approved")]
    [InlineData("reject", "rejected")]
    public async Task Approvals_can_be_approved_or_rejected(string action, string expectedNode)
    {
        var runId = await StartRunAsync(await WorkflowIdAsync("Expense approval"), new JsonObject { ["amount"] = 42 });
        await FlowPilotApp.WaitForRunAsync(_client, runId, "Suspended");

        var pending = (await _client.GetFromJsonAsync<JsonArray>("/api/approvals?status=pending"))!;
        var approval = pending.Single(a => a!["runId"]!.GetValue<string>() == runId)!;
        Assert.Equal("Approve expense of 42", approval["title"]!.GetValue<string>());
        Assert.Equal("Expense approval", approval["workflowName"]!.GetValue<string>());

        var decision = await _client.PostAsJsonAsync($"/api/approvals/{approval["id"]}/{action}", new { comment = "via test" });
        Assert.Equal(HttpStatusCode.NoContent, decision.StatusCode);
        var again = await _client.PostAsJsonAsync($"/api/approvals/{approval["id"]}/{action}", new { });
        Assert.Equal(HttpStatusCode.NotFound, again.StatusCode);

        var run = await FlowPilotApp.WaitForRunAsync(_client, runId, "Completed", "Failed");
        Assert.Equal("Completed", run["status"]!.GetValue<string>());
        Assert.Equal(expectedNode, run["nodes"]!.AsArray().Last()!["nodeId"]!.GetValue<string>());

        var resolved = (await _client.GetFromJsonAsync<JsonArray>("/api/approvals?status=resolved"))!;
        Assert.Contains(resolved, a => a!["id"]!.GetValue<string>() == approval["id"]!.GetValue<string>());
    }

    [Fact]
    public async Task Stats_count_workflows_runs_and_pending_approvals()
    {
        var runId = await StartRunAsync(await WorkflowIdAsync("Order line totals"));
        await FlowPilotApp.WaitForRunAsync(_client, runId, "Completed");

        var stats = (await _client.GetFromJsonAsync<JsonObject>("/api/stats"))!;

        Assert.True(stats["workflows"]!.GetValue<int>() >= 3);
        Assert.True(stats["runs24h"]!.GetValue<int>() >= 1);
        Assert.Equal(7, stats["runsByDay"]!.AsArray().Count);
        Assert.True(stats["runsByDay"]!.AsArray().Last()!["completed"]!.GetValue<int>() >= 1);
    }

    [Fact]
    public async Task Production_errors_do_not_leak_stack_traces()
    {
        var response = await _client.PostAsync("/api/workflows", new StringContent("{ not json", Encoding.UTF8, "application/json"));
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.DoesNotContain("   at ", body);
        Assert.DoesNotContain("Exception", body);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/does-not-exist")).StatusCode);
    }

    [Fact]
    public async Task SignalR_pushes_node_updates_to_clients_that_joined_the_run()
    {
        var runId = await StartRunAsync(await WorkflowIdAsync("Expense approval"), new JsonObject { ["amount"] = 7 });
        await FlowPilotApp.WaitForRunAsync(_client, runId, "Suspended");

        await using var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(app.Server.BaseAddress, "hubs/runs"), o =>
            {
                o.Transports = HttpTransportType.LongPolling; // TestServer has no WebSocket support
                o.HttpMessageHandlerFactory = _ => app.Server.CreateHandler();
            })
            .Build();

        var approvedNode = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        var runUpdates = 0;
        hub.On<JsonElement>("nodeUpdated", update =>
        {
            if (update.GetProperty("nodeId").GetString() == "approve" && update.GetProperty("status").GetString() == "Completed")
                approvedNode.TrySetResult(update);
        });
        hub.On<JsonElement>("runUpdated", _ => Interlocked.Increment(ref runUpdates));

        await hub.StartAsync();
        await hub.InvokeAsync("JoinRun", Guid.Parse(runId));

        var approval = (await _client.GetFromJsonAsync<JsonArray>("/api/approvals"))!.Single(a => a!["runId"]!.GetValue<string>() == runId)!;
        await _client.PostAsJsonAsync($"/api/approvals/{approval["id"]}/approve", new { });

        var update = await approvedNode.Task.WaitAsync(TimeSpan.FromSeconds(15));
        Assert.Equal(runId, update.GetProperty("runId").GetString());
        Assert.Equal("approved", update.GetProperty("outcome").GetString());
        Assert.True(runUpdates > 0);
    }
}

public sealed class ApiKeyTests : IAsyncLifetime
{
    private readonly FlowPilotApp _app = new() { ApiKey = FlowPilotApp.TestApiKey };

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync() => await _app.DisposeAsync();

    [Fact]
    public async Task Api_and_hub_require_the_key_while_health_and_webhooks_stay_open()
    {
        var client = _app.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/workflows")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/hubs/runs/negotiate?negotiateVersion=1", null)).StatusCode);

        client.DefaultRequestHeaders.Add("X-Api-Key", "wrong");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/workflows")).StatusCode);

        client.DefaultRequestHeaders.Remove("X-Api-Key");
        client.DefaultRequestHeaders.Add("X-Api-Key", FlowPilotApp.TestApiKey);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/workflows")).StatusCode);

        var anonymous = _app.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync("/health")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsync($"/hubs/runs/negotiate?negotiateVersion=1&access_token={FlowPilotApp.TestApiKey}", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, (await anonymous.PostAsJsonAsync("/hooks/orders", new { id = 1, total = 1 })).StatusCode);
    }

    [Fact]
    public async Task Hub_negotiate_accepts_the_key_as_a_bearer_token()
    {
        // The SignalR JS client sends accessTokenFactory's value as a Bearer header on negotiate.
        var client = _app.CreateClient();

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "wrong");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/hubs/runs/negotiate?negotiateVersion=1", null)).StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", FlowPilotApp.TestApiKey);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/hubs/runs/negotiate?negotiateVersion=1", null)).StatusCode);
    }
}
