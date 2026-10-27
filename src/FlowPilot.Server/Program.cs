using FlowPilot.Core;
using FlowPilot.Core.Engine;
using FlowPilot.Server;
using FlowPilot.Server.Endpoints;
using FlowPilot.Server.Realtime;
using Microsoft.Extensions.Options;

const string DevCorsPolicy = "dev-ui";

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddFlowPilot();
builder.Services.AddSingleton<IRunEventSink, SignalRRunEventSink>();
builder.Services.ConfigureHttpJsonOptions(o => FlowPilotJson.Configure(o.SerializerOptions));
builder.Services.AddSignalR().AddJsonProtocol(o => FlowPilotJson.Configure(o.PayloadSerializerOptions));
builder.Services.AddProblemDetails();
builder.Services.AddCors(o => o.AddPolicy(DevCorsPolicy, policy => policy
    .WithOrigins("http://localhost:5173")
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

var app = builder.Build();

var settings = app.Services.GetRequiredService<IOptions<FlowPilotOptions>>().Value;
if (!app.Environment.IsDevelopment() && string.IsNullOrEmpty(settings.ApiKey))
{
    app.Logger.LogWarning("""
        **************************************************************************
        FlowPilot:ApiKey is not set. The API, the designer and the SignalR hub are
        open to anyone who can reach this server. Set FlowPilot__ApiKey to secure it.
        **************************************************************************
        """);
}

app.UseExceptionHandler();
if (app.Environment.IsDevelopment()) app.UseCors(DevCorsPolicy);
app.UseMiddleware<ApiKeyMiddleware>();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
app.MapActivityEndpoints();
app.MapWorkflowEndpoints();
app.MapRunEndpoints();
app.MapTriggerEndpoints();
app.MapAiEndpoints();
app.MapHub<RunsHub>("/hubs/runs");

// Unknown API routes are 404s; everything else falls back to the SPA.
app.MapFallback("/api/{**path}", () => Results.NotFound());
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program;
