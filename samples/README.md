# Sample plugin

`FlowPilot.Plugins.Sample` adds two activities, `text.transform` and `random.number`, from outside the core.

To load it into a running server:

```bash
dotnet publish samples/FlowPilot.Plugins.Sample -c Release -o src/FlowPilot.Server/plugins/FlowPilot.Plugins.Sample
dotnet run --project src/FlowPilot.Server
```

The server scans `FlowPilot:PluginsPath` (default `plugins`, relative to the working directory) for `<Name>/<Name>.dll`.
Each plugin folder gets its own `AssemblyLoadContext`. `FlowPilot.Abstractions` always comes from the host, so the
project reference uses `Private=false` and `ExcludeAssets=runtime` to keep it out of the plugin output.

In-process alternative, without a plugins folder:

```csharp
builder.Services.AddFlowPilot().AddActivity<TextTransformActivity>();
```
