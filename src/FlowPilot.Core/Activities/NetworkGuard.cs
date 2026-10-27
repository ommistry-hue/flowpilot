using System.Net;
using System.Net.Sockets;

namespace FlowPilot.Core.Activities;

/// <summary>Optional SSRF protection for <c>http.request</c>: rejects connections to non-public addresses.</summary>
public static class NetworkGuard
{
    public static SocketsHttpHandler CreateHandler(HttpOptions options)
    {
        var handler = new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(5) };
        if (options.BlockPrivateNetworks)
        {
            // A proxy would make the connect-time check see the proxy's address instead of the target's.
            handler.UseProxy = false;
            handler.ConnectCallback = ConnectToPublicAddressAsync;
        }
        return handler;
    }

    // Checking at connect time (not on the URL) also covers redirects and DNS rebinding.
    private static async ValueTask<Stream> ConnectToPublicAddressAsync(SocketsHttpConnectionContext context, CancellationToken ct)
    {
        var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, ct);
        var allowed = addresses.Where(IsPublic).ToArray();
        if (allowed.Length == 0)
            throw new HttpRequestException($"Blocked request to '{context.DnsEndPoint.Host}': it resolves to a private or reserved address.");

        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(allowed, context.DnsEndPoint.Port, ct);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    public static bool IsPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (IPAddress.IsLoopback(address) || address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any)) return false;

        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = address.GetAddressBytes();
            return !(b[0] == 10
                || b[0] == 0
                || (b[0] == 100 && b[1] >= 64 && b[1] <= 127)   // carrier-grade NAT
                || (b[0] == 169 && b[1] == 254)                // link-local, cloud metadata
                || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
                || (b[0] == 192 && b[1] == 168)
                || b[0] >= 224);                               // multicast and reserved
        }

        var bytes = address.GetAddressBytes();
        var isNat64 = bytes[0] == 0x00 && bytes[1] == 0x64 && bytes[2] == 0xff && bytes[3] == 0x9b && bytes[4..12].All(b => b == 0); // 64:ff9b::/96
        var is6to4 = bytes[0] == 0x20 && bytes[1] == 0x02;                                                                      // 2002::/16
        return !(address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.IsIPv6Multicast || address.IsIPv6UniqueLocal || isNat64 || is6to4);
    }
}
