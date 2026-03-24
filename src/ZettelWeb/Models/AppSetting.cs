namespace ZettelWeb.Models;

/// <summary>Persistent key-value store for application settings (e.g. LLM model preference).</summary>
public class AppSetting
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
