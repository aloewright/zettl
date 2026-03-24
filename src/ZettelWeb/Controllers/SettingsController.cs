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

    /// <summary>
    /// Initializes a new instance of <see cref="SettingsController"/> with its required services.
    /// </summary>
    /// <param name="db">Entity Framework database context for accessing application settings.</param>
    /// <param name="cache">In-memory application settings cache used for fast reads and updates.</param>
    /// <param name="httpClientFactory">Factory to create named HTTP clients for fetching external model lists.</param>
    /// <param name="configuration">Application configuration source for provider keys and gateway URLs.</param>
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

    /// <summary>
    /// Retrieves the current LLM provider and model, reading values from the settings cache with configuration fallbacks.
    /// </summary>
    /// <returns>An OK (<c>200</c>) response containing an anonymous object with `provider` and `model` properties.</returns>
    [HttpGet]
    public IActionResult GetSettings()
    {
        var provider = _cache.Get("llm:provider",
            _configuration["ContentGeneration:Provider"] ?? "openrouter");
        var model = _cache.Get("llm:model",
            _configuration["ContentGeneration:Model"] ?? "");
        return Ok(new { provider, model });
    }

    /// <summary>
    /// Updates persisted LLM provider and model settings and refreshes the in-memory cache.
    /// </summary>
    /// <param name="request">Request containing the provider and model identifiers to set.</param>
    /// <param name="cancellationToken">Token to cancel the operation.</param>
    /// <returns>204 No Content on success; 400 Bad Request when provider or model is missing.</returns>
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

    /// <summary>
    /// Returns available LLM models from configured providers, using an in-memory cache with a 10-minute time-to-live.
    /// </summary>
    /// <param name="cancellationToken">Token to cancel the operation while waiting for or performing a cache refresh.</param>
    /// <returns>
    /// An <see cref="AvailableModels"/> object wrapped in a 200 OK response containing model lists for each provider;
    /// when the cache is expired the endpoint refreshes the lists (only one refresh occurs concurrently) and then returns the refreshed value.
    /// </returns>
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

    /// <summary>
    /// Gets available models from the OpenRouter API and converts them into LlmModelInfo entries.
    /// </summary>
    /// <param name="aiGatewayUrl">Optional base URL of an AI gateway to route the OpenRouter request; when null or empty the default OpenRouter endpoint is used.</param>
    /// <param name="apiKey">OpenRouter API key used for authorization; when empty the method returns an empty list.</param>
    /// <returns>A list of LlmModelInfo objects for each discovered model, or an empty list if the API key is missing, the HTTP request fails, or the response cannot be parsed.</returns>

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

    /// <summary>
    /// Fetches available Google generative models and returns entries for models that support the "generateContent" generation method.
    /// </summary>
    /// <param name="aiGatewayUrl">Optional base URL of a configured AI gateway; when provided the request is routed through this gateway, otherwise the public Google endpoint is used.</param>
    /// <param name="apiKey">Google API key; when empty the method returns an empty list.</param>
    /// <returns>A list of LlmModelInfo for models that support "generateContent"; returns an empty list on HTTP errors, parse errors, or when no API key is provided.</returns>
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

    /// <summary>
    /// Inserts a new AppSetting into the DbContext or updates the existing setting for the specified key.
    /// </summary>
    /// <param name="key">The settings key to insert or update.</param>
    /// <param name="value">The value to store for the key.</param>
    /// <param name="now">Timestamp to set on the setting's UpdatedAt field.</param>
    /// <param name="ct">Cancellation token for the database lookup operation.</param>
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
