using Microsoft.Extensions.AI;
using OpenAI;
using System.ClientModel;

namespace ZettelWeb.Services;

/// <summary>
/// Singleton <see cref="IChatClient"/> that builds the underlying provider client
/// on every call based on the current model preference in <see cref="AppSettingsCache"/>.
/// Supports OpenRouter and Google AI Studio, both routed through the Cloudflare AI Gateway
/// when configured.
/// </summary>
public class DynamicChatClient : IChatClient
{
    private readonly AppSettingsCache _cache;
    private readonly string _aiGatewayUrl;
    private readonly string _openRouterApiKey;
    private readonly string _googleApiKey;
    private readonly string _defaultProvider;
    private readonly string _defaultModel;

    public DynamicChatClient(
        AppSettingsCache cache,
        string aiGatewayUrl,
        string openRouterApiKey,
        string googleApiKey,
        string defaultProvider,
        string defaultModel)
    {
        _cache = cache;
        _aiGatewayUrl = aiGatewayUrl;
        _openRouterApiKey = openRouterApiKey;
        _googleApiKey = googleApiKey;
        _defaultProvider = defaultProvider;
        _defaultModel = defaultModel;
    }

    private IChatClient BuildClient()
    {
        var provider = _cache.Get("llm:provider", _defaultProvider);
        var model    = _cache.Get("llm:model",    _defaultModel);

        string baseUrl;
        string apiKey;

        if (string.Equals(provider, "google", StringComparison.OrdinalIgnoreCase))
        {
            // Google AI Studio exposes an OpenAI-compatible endpoint.
            // Route through Cloudflare AI Gateway when configured.
            baseUrl = string.IsNullOrEmpty(_aiGatewayUrl)
                ? "https://generativelanguage.googleapis.com/v1beta/openai"
                : $"{_aiGatewayUrl}/google-ai-studio/v1beta/openai";
            apiKey = _googleApiKey;
        }
        else // "openrouter" (default)
        {
            baseUrl = string.IsNullOrEmpty(_aiGatewayUrl)
                ? "https://openrouter.ai/api/v1"
                : $"{_aiGatewayUrl}/openrouter";
            apiKey = _openRouterApiKey;
        }

        var options = new OpenAIClientOptions { Endpoint = new Uri(baseUrl) };
        return new OpenAIClient(new ApiKeyCredential(apiKey), options)
            .GetChatClient(model)
            .AsIChatClient();
    }

    public Task<ChatResponse> GetResponseAsync(
        IList<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken cancellationToken = default)
        => BuildClient().GetResponseAsync(messages, options, cancellationToken);

    public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IList<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken cancellationToken = default)
        => BuildClient().GetStreamingResponseAsync(messages, options, cancellationToken);

    public object? GetService(Type serviceType, object? serviceKey = null)
        => BuildClient().GetService(serviceType, serviceKey);

    public void Dispose() { }
}
