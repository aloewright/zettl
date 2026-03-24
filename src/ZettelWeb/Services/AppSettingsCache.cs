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

    /// <summary>
        /// Retrieves a cached setting value by key.
        /// </summary>
        /// <param name="key">The setting key to look up; lookup is case-insensitive.</param>
        /// <param name="defaultValue">Value to return when the key is not present in the cache. Defaults to empty string.</param>
        /// <returns>The cached value for the specified key, or <paramref name="defaultValue"/> if the key is not found.</returns>
        public string Get(string key, string defaultValue = "")
        => _cache.TryGetValue(key, out var value) ? value : defaultValue;

    /// <summary>
        /// Stores or updates the value for the specified setting key in the in-memory cache. Keys are matched case-insensitively.
        /// </summary>
        /// <param name="key">The setting key to set.</param>
        /// <param name="value">The value to associate with the key.</param>
        public void Set(string key, string value)
        => _cache[key] = value;

    /// <summary>
    /// Populate the in-memory cache with the provided collection of AppSetting entries.
    /// </summary>
    /// <param name="settings">A sequence of AppSetting items whose Key and Value pairs will be stored in the cache.</param>
    public void Load(IEnumerable<AppSetting> settings)
    {
        foreach (var s in settings)
            _cache[s.Key] = s.Value;
    }
}
