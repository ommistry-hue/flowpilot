using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace FlowPilot.Core.Engine;

/// <summary>An incoming <c>/hooks/*</c> call. <see cref="Body"/> holds the raw bytes for signature checks.</summary>
public sealed record WebhookRequest(string Path, string Method, JsonNode Payload, byte[] Body, string? SecretHeader, string? SignatureHeader)
{
    public const string SecretHeaderName = "X-FlowPilot-Secret";
    public const string SignatureHeaderName = "X-Hub-Signature-256";
}

/// <param name="Matched">Whether any published webhook trigger listens on this path and method.</param>
/// <param name="RunIds">Runs started; empty with <paramref name="Matched"/> true means every matching trigger rejected the credentials.</param>
public sealed record WebhookDispatch(bool Matched, IReadOnlyList<Guid> RunIds);

public static class WebhookAuth
{
    /// <summary>
    /// Accepts the shared secret in <c>X-FlowPilot-Secret</c>, or a GitHub-style
    /// <c>X-Hub-Signature-256: sha256=&lt;hex HMAC of the body&gt;</c>. Both comparisons are constant-time.
    /// </summary>
    public static bool Verify(string secret, WebhookRequest request)
    {
        if (request.SecretHeader is { } provided && FixedTimeEquals(provided, secret))
            return true;

        if (request.SignatureHeader is { } signature && signature.StartsWith("sha256=", StringComparison.OrdinalIgnoreCase))
        {
            var expected = "sha256=" + Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), request.Body));
            return FixedTimeEquals(signature.ToLowerInvariant(), expected);
        }
        return false;
    }

    /// <summary>Hashing first gives equal-length inputs, so neither content nor length leaks through timing.</summary>
    public static bool FixedTimeEquals(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(a)), SHA256.HashData(Encoding.UTF8.GetBytes(b)));
}
