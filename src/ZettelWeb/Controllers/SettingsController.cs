using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Net.Http.Headers;
using System.Text.Json;
using ZettelWeb.Data;
using ZettelWeb.Models;
using ZettelWeb.Services;

namespace ZettelWeb.Controllers;

[ApiController]
[Route("api/settings")]
public class SettingsController : ControllerBase
{
    private readonly ZettelDbContext _db;
    private readonly AppSettingsCache _cache;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;

    // Server-side model list cache shared across requests (10-minute TTL).
    private static readonly SemaphoreSlim _modelCacheLock = new(1, 1);
    private static AvailableModels? _modelsCache;
    private static DateTime _modelsCacheExpiry = DateTime.MinValue;

    public SettingsController(
        ZettelDbContext db,
        AppSettingsCache cache,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration)
    {
        _db = db;
        _cache = cache;
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
    }

    // GET /api/settings
    [HttpGet]
    public IActionResult GetSettings()
    {
        var provider = _cache.Get("llm:provider",
            _configuration["ContentGeneration:Provider"] ?? "openrouter");
        var model = _cache.Get("llm:model",
            _configuration["ContentGeneration:Model"] ?? "");
        return Ok(new { provider, model });
    }

    // PUT /api/settings/model
    [HttpPut("model")]
    public async Task<IActionResult> UpdateModel(
        [FromBody] UpdateModelRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Provider) || string.IsNullOrWhiteSpace(request.Model))
            return BadRequest("Provider and model are required.");

        var now = DateTime.UtcNow;
        await UpsertSettingAsync("llm:provider", request.Provider, now, cancellationToken);
        await UpsertSettingAsync("llm:model", request.Model, now, cancellationToken);

        _cache.Set("llm:provider", request.Provider);
        _cache.Set("llm:model", request.Model);

        await _db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    // GET /api/settings/models
    [HttpGet("models")]
    public async Task<IActionResult> GetModels(CancellationToken cancellationToken)
    {
        if (_modelsCache is not null && DateTime.UtcNow < _modelsCacheExpiry)
            return Ok(_modelsCache);

        await _modelCacheLock.WaitAsync(cancellationToken);
        try
        {
            // Double-check after acquiring lock
            if (_modelsCache is not null && DateTime.UtcNow < _modelsCacheExpiry)
                return Ok(_modelsCache);

            var aiGatewayUrl = _configuration["Cloudflare:AiGatewayUrl"]?.TrimEnd('/');
            var openRouterKey = _configuration["OpenRouter:ApiKey"] ?? "";
            var googleKey = _configuration["Google:ApiKey"] ?? "";

            var (openRouterModels, googleModels) = await (
                FetchOpenRouterModelsAsync(aiGatewayUrl, openRouterKey, cancellationToken),
                FetchGoogleModelsAsync(aiGatewayUrl, googleKey, cancellationToken)
            );

            _modelsCache = new AvailableModels(openRouterModels, googleModels);
            _modelsCacheExpiry = DateTime.UtcNow.AddMinutes(10);
            return Ok(_modelsCache);
        }
        finally
        {
            _modelCacheLock.Release();
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────

    private async Task<List<LlmModelInfo>> FetchOpenRouterModelsAsync(
        string? aiGatewayUrl, string apiKey, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(apiKey)) return [];

        try
        {
            var url = string.IsNullOrEmpty(aiGatewayUrl)
                ? "https://openrouter.ai/api/v1/models"
                : $"{aiGatewayUrl}/openrouter/v1/models";

            var client = _httpClientFactory.CreateClient("Models");
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", apiKey);

            var response = await client.GetAsync(url, ct);
            if (!response.IsSuccessStatusCode) return [];

            var json = await response.Content.ReadAsStringAsync(ct);
            var doc = JsonDocument.Parse(json);
            var models = new List<LlmModelInfo>();

            foreach (var item in doc.RootElement.GetProperty("data").EnumerateArray())
            {
                var id = item.GetProperty("id").GetString() ?? "";
                if (string.IsNullOrEmpty(id)) continue;

                var name = item.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String
                    ? n.GetString() ?? id
                    : id;

                long? ctx = null;
                if (item.TryGetProperty("context_length", out var cl) &&
                    cl.ValueKind == JsonValueKind.Number)
                    ctx = cl.GetInt64();

                models.Add(new LlmModelInfo(id, name, ctx));
            }

            return [.. models.OrderBy(m => m.Name)];
        }
        catch
        {
            return [];
        }
    }

    private async Task<List<LlmModelInfo>> FetchGoogleModelsAsync(
        string? aiGatewayUrl, string apiKey, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(apiKey)) return [];

        try
        {
            var url = string.IsNullOrEmpty(aiGatewayUrl)
                ? $"https://generativelanguage.googleapis.com/v1beta/models?key={apiKey}"
                : $"{aiGatewayUrl}/google-ai-studio/v1beta/models?key={apiKey}";

            var client = _httpClientFactory.CreateClient("Models");
            var response = await client.GetAsync(url, ct);
            if (!response.IsSuccessStatusCode) return [];

            var json = await response.Content.ReadAsStringAsync(ct);
            var doc = JsonDocument.Parse(json);
            var models = new List<LlmModelInfo>();

            foreach (var item in doc.RootElement.GetProperty("models").EnumerateArray())
            {
                var name = item.GetProperty("name").GetString() ?? "";
                var id = name.StartsWith("models/") ? name["models/".Length..] : name;
                if (string.IsNullOrEmpty(id)) continue;

                // Only include generateContent-capable models
                var supported = item.TryGetProperty("supportedGenerationMethods", out var sm)
                    ? sm.EnumerateArray().Select(e => e.GetString()).ToList()
                    : [];
                if (!supported.Contains("generateContent")) continue;

                var displayName = item.TryGetProperty("displayName", out var dn) &&
                                  dn.ValueKind == JsonValueKind.String
                    ? dn.GetString() ?? id
                    : id;

                models.Add(new LlmModelInfo(id, displayName, null));
            }

            return [.. models.OrderBy(m => m.Name)];
        }
        catch
        {
            return [];
        }
    }

    private async Task UpsertSettingAsync(
        string key, string value, DateTime now, CancellationToken ct)
    {
        var existing = await _db.AppSettings.FindAsync([key], ct);
        if (existing is null)
            _db.AppSettings.Add(new AppSetting { Key = key, Value = value, UpdatedAt = now });
        else
        {
            existing.Value = value;
            existing.UpdatedAt = now;
        }
    }
}

public record UpdateModelRequest(string Provider, string Model);
