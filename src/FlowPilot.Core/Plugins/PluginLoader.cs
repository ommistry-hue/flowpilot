using System.Reflection;
using System.Runtime.Loader;
using FlowPilot.Core.Activities;
using Microsoft.Extensions.Logging;

namespace FlowPilot.Core.Plugins;

/// <summary>Loads <c>plugins/&lt;Name&gt;/&lt;Name&gt;.dll</c>, each into its own load context.</summary>
public static class PluginLoader
{
    public static IReadOnlyList<Type> LoadActivityTypes(string? pluginsPath, ILogger logger)
    {
        if (string.IsNullOrWhiteSpace(pluginsPath)) return [];
        var root = Path.GetFullPath(pluginsPath);
        if (!Directory.Exists(root)) return [];

        var types = new List<Type>();
        foreach (var folder in Directory.GetDirectories(root))
        {
            var name = Path.GetFileName(folder);
            var assemblyPath = Path.Combine(folder, name + ".dll");
            if (!File.Exists(assemblyPath))
            {
                logger.LogWarning("Plugin folder {Folder} has no {Name}.dll; skipping", folder, name);
                continue;
            }

            try
            {
                var context = new PluginLoadContext(assemblyPath);
                var assembly = context.LoadFromAssemblyPath(assemblyPath);
                var found = ActivityScanner.FindActivityTypes(assembly).ToList();
                types.AddRange(found);
                logger.LogInformation("Loaded plugin {Name} with {Count} activities", name, found.Count);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to load plugin {Name}", name);
            }
        }
        return types;
    }

    private sealed class PluginLoadContext(string assemblyPath) : AssemblyLoadContext(Path.GetFileNameWithoutExtension(assemblyPath))
    {
        private readonly AssemblyDependencyResolver _resolver = new(assemblyPath);

        protected override Assembly? Load(AssemblyName name)
        {
            // Anything the host already knows (FlowPilot.Abstractions, the framework, shared packages)
            // must come from the default context, otherwise IActivity would be a different type.
            if (IsAvailableInHost(name)) return null;

            var path = _resolver.ResolveAssemblyToPath(name);
            return path is null ? null : LoadFromAssemblyPath(path);
        }

        protected override IntPtr LoadUnmanagedDll(string unmanagedDllName)
        {
            var path = _resolver.ResolveUnmanagedDllToPath(unmanagedDllName);
            return path is null ? IntPtr.Zero : LoadUnmanagedDllFromPath(path);
        }

        private static bool IsAvailableInHost(AssemblyName name)
        {
            try
            {
                Default.LoadFromAssemblyName(name);
                return true;
            }
            catch (Exception ex) when (ex is FileNotFoundException or FileLoadException)
            {
                return false;
            }
        }
    }
}
