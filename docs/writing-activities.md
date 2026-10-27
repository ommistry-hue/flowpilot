# Writing activities

An activity is a node type. It is one C# class that implements `IActivity` and carries an `[Activity]` attribute. The designer builds its palette entry and config form from the attributes, so there is no UI code to write.

Everything here comes from `FlowPilot.Abstractions` (`src/FlowPilot.Abstractions/Activities.cs`).

## The smallest activity

```csharp
using System.Text.Json.Nodes;
using FlowPilot.Abstractions;

[Activity("text.reverse", DisplayName = "Reverse text", Category = "Text",
    Description = "Reverses a string.")]
public sealed class ReverseText : IActivity
{
    [Input(DisplayName = "Text", Required = true)]
    public string Text { get; set; } = "";

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken cancellationToken)
    {
        var reversed = new string(Text.Reverse().ToArray());
        return Task.FromResult(ActivityResult.Done(new JsonObject { ["result"] = reversed }));
    }
}
```

A new instance is created for every execution. `[Input]` properties are bound from the node's `config` after `{{ }}` expressions are evaluated. The config key is the camelCase property name: `Text` binds from `config.text`.

## `[Activity]` reference

`[Activity(string type)]` on the class.

| Property | Type | Default | Purpose |
|---|---|---|---|
| `Type` (constructor) | string | — | Unique type name used in workflow JSON. Lowercase and dotted: `slack.message` |
| `DisplayName` | string? | type | Name in the palette |
| `Category` | string | `"General"` | Palette group |
| `Description` | string? | — | Tooltip and help text; also given to the AI generator |
| `Icon` | string? | — | Icon name for the designer |
| `Outcomes` | string[] | `["done"]` | The outcomes this activity can emit, one output handle each |
| `DynamicOutcomes` | bool | `false` | Outcomes come from config (as with `switch` cases). The designer reads them from config |
| `IsTrigger` | bool | `false` | Marks a trigger node that starts runs |

Write descriptions for humans and for the AI generator: the generator builds its prompt from them.

## `[Input]` reference

`[Input]` on a public settable property.

| Property | Type | Default | Purpose |
|---|---|---|---|
| `DisplayName` | string? | property name | Field label |
| `Description` | string? | — | Help text under the field |
| `Kind` | `InputKind` | `Text` | Editor to show (below) |
| `Options` | string[]? | — | Choices for `Select` |
| `Required` | bool | `false` | Validation fails when missing |
| `DefaultValue` | object? | — | Pre-filled value for new nodes |

### `InputKind`

| Kind | Editor | Typical C# type | Notes |
|---|---|---|---|
| `Text` | Single-line text | `string` | Supports `{{ }}` |
| `Multiline` | Text area | `string` | Messages, prompts, templates |
| `Expression` | JS editor | `string` | Raw JS **without** braces. Evaluate it yourself with `context.Expressions.Evaluate(...)` |
| `Number` | Number field | `int`, `double`, `decimal` | |
| `Boolean` | Toggle | `bool` | |
| `Json` | JSON editor | `JsonNode`, `JsonObject` | Headers, payloads |
| `Select` | Dropdown | `string` | Set `Options` |
| `Code` | Code editor | `string` | Scripts, SQL, templates |

## `ActivityContext`

| Member | Description |
|---|---|
| `RunId`, `NodeId`, `Attempt` | Identity of this execution. `Attempt` starts at 1 and grows with retries |
| `Config` | The node config after expression evaluation, as a `JsonObject` |
| `Input` | Output of the node that led here (the trigger payload for triggers) |
| `Variables` | Run variables. Changes are persisted when the activity completes |
| `NodeState` | Per-node state that survives loop re-entry and suspension |
| `ResumePayload` | `null` on first entry; the resolution data when resumed from a bookmark |
| `Services` | The DI container. Resolve `IHttpClientFactory`, options, your own services |
| `Logger` | An `ILogger` scoped to the run and node |
| `Expressions` | Evaluates raw JS in the run scope |

## `ActivityResult`

| Factory | Status | Effect |
|---|---|---|
| `ActivityResult.Done(output?)` | Completed | Follows the `done` edges |
| `ActivityResult.WithOutcome(outcome, output?)` | Completed | Follows the edges for `outcome`, e.g. `Outcomes.True` |
| `ActivityResult.Suspend(bookmark)` | Suspended | Parks the run until the bookmark is resolved |
| `ActivityResult.Fail(error)` | Failed | Retries per the node's retry policy, then follows `error` edges, else fails the run |

Use the constants in `Outcomes`: `Done`, `True`, `False`, `Error`, `Item`, `Approved`, `Rejected`.

Return `Fail` for expected errors (bad input, 4xx/5xx responses). Thrown exceptions are treated as failures too, but `Fail` gives users a clean message.

### Custom outcomes

```csharp
[Activity("lead.score", Category = "Sales", Outcomes = ["hot", "warm", "cold"])]
public sealed class ScoreLead : IActivity
{
    [Input(Kind = InputKind.Number, DefaultValue = 70)] public int HotThreshold { get; set; } = 70;

    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken ct)
    {
        var score = context.Input?["score"]?.GetValue<int>() ?? 0;
        var outcome = score >= HotThreshold ? "hot" : score >= 40 ? "warm" : "cold";
        return Task.FromResult(ActivityResult.WithOutcome(outcome, new JsonObject { ["score"] = score }));
    }
}
```

### Calling an HTTP API

```csharp
[Activity("slack.message", DisplayName = "Slack message", Category = "Messaging",
    Description = "Posts a message to a Slack incoming webhook.")]
public sealed class SlackMessage : IActivity
{
    [Input(Required = true, Description = "Incoming webhook URL")] public string WebhookUrl { get; set; } = "";
    [Input(Kind = InputKind.Multiline, Required = true)] public string Text { get; set; } = "";

    public async Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken ct)
    {
        var http = context.Services.GetRequiredService<IHttpClientFactory>().CreateClient();
        using var response = await http.PostAsJsonAsync(WebhookUrl, new { text = Text }, ct);
        return response.IsSuccessStatusCode
            ? ActivityResult.Done(new JsonObject { ["status"] = (int)response.StatusCode })
            : ActivityResult.Fail($"Slack returned {(int)response.StatusCode}");
    }
}
```

Delivery is at-least-once: after a crash, an activity can run again for the same `RunId` and `NodeId`. Pass an idempotency key derived from them when the target API supports one.

## Suspension and bookmarks

An activity that waits for something external returns `Suspend` instead of blocking. The run is stored as `Suspended` with a bookmark and holds no thread. When the bookmark is resolved, the engine runs the **same node again** with `context.ResumePayload` set.

```csharp
public sealed record BookmarkRequest(
    BookmarkKind Kind,                 // Approval, Delay or Event
    DateTimeOffset? ResumeAt = null,   // Delay: when to resume
    string? CorrelationKey = null,     // Event: which event resumes this run
    JsonNode? Payload = null);         // Shown in the UI / approval inbox
```

| Kind | Resolved by |
|---|---|
| `Delay` | The bookmark worker, once `ResumeAt <= now` |
| `Approval` | `POST /api/approvals/{bookmarkId}/approve` or `/reject` (the UI inbox uses these) |
| `Event` | `POST /api/events/{name}` with a matching `correlationKey` |

The pattern is always "first entry suspends, second entry completes". Approval and event resumes carry data in `ResumePayload`. For a timer, mark the wait in `NodeState` so the second entry can tell it was resumed:

```csharp
[Activity("wait.until.business.hours", Category = "Timing")]
public sealed class WaitForBusinessHours : IActivity
{
    public Task<ActivityResult> ExecuteAsync(ActivityContext context, CancellationToken ct)
    {
        if (context.NodeState.Remove("waiting"))          // second entry: the wait is over
            return Task.FromResult(ActivityResult.Done(context.Input));

        var now = DateTimeOffset.UtcNow;
        if (now.Hour is >= 9 and < 17)
            return Task.FromResult(ActivityResult.Done(context.Input));

        var next = now.Date.AddDays(now.Hour >= 17 ? 1 : 0).AddHours(9);
        context.NodeState["waiting"] = true;              // persisted with the bookmark
        return Task.FromResult(ActivityResult.Suspend(
            new BookmarkRequest(BookmarkKind.Delay, ResumeAt: new DateTimeOffset(next, TimeSpan.Zero))));
    }
}
```

Use `NodeState` for anything you need on resume that is not in `ResumePayload`. It is persisted with the bookmark.

## Registering activities

### In code (embedded hosts)

```csharp
builder.Services.AddFlowPilot()
    .AddActivity<ReverseText>()
    .AddActivity<SlackMessage>();
```

### As a plugin DLL

Create a class library that references only `FlowPilot.Abstractions`, and keep the reference out of the output so the host's copy is used:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <EnableDynamicLoading>true</EnableDynamicLoading>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="..\..\src\FlowPilot.Abstractions\FlowPilot.Abstractions.csproj">
      <Private>false</Private>
      <ExcludeAssets>runtime</ExcludeAssets>
    </ProjectReference>
  </ItemGroup>
</Project>
```

`samples/FlowPilot.Plugins.Sample` is a working example.

Publish it and copy the output into its own folder under the plugins path (`FlowPilot:PluginsPath`, default `./plugins`):

```bash
dotnet publish samples/FlowPilot.Plugins.Sample -c Release -o plugins/FlowPilot.Plugins.Sample
```

```text
plugins/
├── FlowPilot.Plugins.Sample/
│   ├── FlowPilot.Plugins.Sample.dll    # folder name == assembly name
│   ├── FlowPilot.Plugins.Sample.deps.json
│   └── SomeDependency.dll              # private dependencies go here
└── Acme.Crm/
    ├── Acme.Crm.dll
    ├── Acme.Crm.deps.json
    └── Newtonsoft.Json.dll             # can differ from other plugins' versions
```

How loading works:

- Each folder gets its own `AssemblyLoadContext` with an `AssemblyDependencyResolver` reading the plugin's `.deps.json`.
- `FlowPilot.Abstractions` and framework assemblies always resolve from the host's default context. That is why the plugin must not ship its own copy of `FlowPilot.Abstractions.dll`: a second copy makes `IActivity` a different type and the activity is not found.
- Every non-abstract `IActivity` class with an `[Activity]` attribute is registered.
- Plugins load at startup. Restart the server after adding or updating one.

With Docker Compose, `./plugins` is mounted at `/app/plugins`.

Plugins run in-process with full trust. Install only code you trust.

## Testing

Construct the activity, set its inputs, and call `ExecuteAsync` with an `ActivityContext`:

```csharp
var activity = new ReverseText { Text = "abc" };
var context = new ActivityContext
{
    RunId = Guid.NewGuid(), NodeId = "n1", Attempt = 1,
    Config = [], Variables = [], NodeState = [],
    Services = new ServiceCollection().BuildServiceProvider(),
    Logger = NullLogger.Instance,
    Expressions = new FakeExpressions(),   // your own IExpressionEvaluator stub
};

var result = await activity.ExecuteAsync(context, CancellationToken.None);

Assert.Equal(ActivityStatus.Completed, result.Status);
Assert.Equal("cba", result.Output!["result"]!.GetValue<string>());
```

## Checklist

- [ ] Type name is lowercase and dotted
- [ ] `DisplayName`, `Category` and `Description` set; every input has a label
- [ ] Expected errors return `Fail` with a message a user can act on
- [ ] `CancellationToken` passed to every async call
- [ ] Side effects are idempotent, or the docs say they are not
- [ ] Secrets come from configuration, not from defaults in code
