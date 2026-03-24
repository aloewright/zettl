using System.Collections.Concurrent;
using ZettelWeb.Models;

namespace ZettelWeb.Services;

/// <summary>
/// Singleton in-memory cache for application settings, backed by the AppSettings table.
/// Populated at startup; updates are written through to the database by the controller.
/// </summary>
public class AppSettingsCache
{
    private readonly ConcurrentDictionary<string, string> _cache = new(StringComparer.OrdinalIgnoreCase);

    public string Get(string key, string defaultValue = "")
        => _cache.TryGetValue(key, out var value) ? value : defaultValue;

    public void Set(string key, string value)
        => _cache[key] = value;

    /// <summary>Bulk-load settings from the database on startup.</summary>
    public void Load(IEnumerable<AppSetting> settings)
    {
        foreach (var s in settings)
            _cache[s.Key] = s.Value;
    }
}
