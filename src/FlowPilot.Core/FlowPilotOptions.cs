namespace FlowPilot.Core;

public sealed class FlowPilotOptions
{
    /// <summary><c>sqlite</c> (default) or <c>postgres</c>.</summary>
    public string DatabaseProvider { get; set; } = "sqlite";
    public string ConnectionString { get; set; } = "Data Source=flowpilot.db";
    public string PluginsPath { get; set; } = "plugins";
    public string? ApiKey { get; set; }
    public bool SeedSampleWorkflows { get; set; } = true;
    public TimeSpan PollInterval { get; set; } = TimeSpan.FromMilliseconds(500);
    public TimeSpan LeaseDuration { get; set; } = TimeSpan.FromMinutes(5);
    public EngineOptions Engine { get; set; } = new();
    public AiOptions AI { get; set; } = new();
    public HttpOptions Http { get; set; } = new();
    public WebhookOptions Webhooks { get; set; } = new();
    public RetentionOptions Retention { get; set; } = new();

    public bool IsPostgres => DatabaseProvider.Equals("postgres", StringComparison.OrdinalIgnoreCase)
        || DatabaseProvider.Equals("postgresql", StringComparison.OrdinalIgnoreCase);
}

public sealed class EngineOptions
{
    /// <summary>Work items executed concurrently by this process.</summary>
    public int Workers { get; set; } = Math.Max(4, Environment.ProcessorCount * 2);

    /// <summary>A run that executes more nodes than this fails, which stops runaway loops.</summary>
    public int MaxStepsPerRun { get; set; } = 10_000;
}

public sealed class AiOptions
{
    /// <summary><c>anthropic</c> or <c>openai</c> (any OpenAI-compatible endpoint).</summary>
    public string Provider { get; set; } = "anthropic";
    public string? ApiKey { get; set; }
    public string Model { get; set; } = "claude-sonnet-5-5";
    public string? BaseUrl { get; set; }
    /// <summary>Value of the <c>anthropic-version</c> header sent to the Messages API.</summary>
    public string AnthropicVersion { get; set; } = "2026-10-21";

    public bool IsOpenAi => Provider.Equals("openai", StringComparison.OrdinalIgnoreCase);

    /// <summary>OpenAI-compatible servers such as Ollama often need no key, only a base URL.</summary>
    public bool Enabled => !string.IsNullOrWhiteSpace(ApiKey) || (IsOpenAi && !string.IsNullOrWhiteSpace(BaseUrl));
}

public sealed class HttpOptions
{
    /// <summary>
    /// When true, <c>http.request</c> refuses to connect to loopback, private, link-local and other
    /// non-public addresses (checked after DNS resolution, so rebinding tricks don't bypass it).
    /// </summary>
    public bool BlockPrivateNetworks { get; set; }

    /// <summary>Responses larger than this fail the <c>http.request</c> node.</summary>
    public long MaxResponseBytes { get; set; } = 10 * 1024 * 1024;
}

public sealed class WebhookOptions
{
    /// <summary>Requests to <c>/hooks/*</c> with a larger body are rejected with 413.</summary>
    public long MaxBodyBytes { get; set; } = 1024 * 1024;
}

public sealed class RetentionOptions
{
    /// <summary>Finished runs older than this are deleted. 0 keeps them forever.</summary>
    public int Days { get; set; } = 30;
}
