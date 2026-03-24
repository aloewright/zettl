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

    /// <summary>
    /// Initializes a new instance of DynamicChatClient and stores configuration values used to build provider-backed chat clients at runtime.
    /// </summary>
    /// <param name="cache">Cache that provides the current LLM provider and model settings.</param>
    /// <param name="aiGatewayUrl">Optional Cloudflare AI Gateway base URL used to route requests; may be empty to use provider defaults.</param>
    /// <param name="openRouterApiKey">API key for the OpenRouter provider.</param>
    /// <param name="googleApiKey">API key for the Google AI provider.</param>
    /// <param name="defaultProvider">Fallback provider name to use when the cache does not specify one.</param>
    /// <param name="defaultModel">Fallback model identifier to use when the cache does not specify one.</param>
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

    /// <summary>
    /// Creates an IChatClient configured for the currently selected LLM provider and model from the app settings cache.
    /// </summary>
    /// <returns>An IChatClient instance configured to connect to the resolved provider endpoint and authenticated with the corresponding API key for the resolved model.</returns>
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

    /// <summary>
        /// Sends the provided conversation messages to the currently configured language model and returns a single complete chat response.
        /// </summary>
        /// <param name="messages">Conversation messages to send, ordered from earliest to latest.</param>
        /// <param name="options">Optional generation parameters such as temperature, max tokens, and other model settings.</param>
        /// <param name="cancellationToken">Token to cancel the request.</param>
        /// <returns>The chat response produced by the model.</returns>
        public Task<ChatResponse> GetResponseAsync(
        IList<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken cancellationToken = default)
        => BuildClient().GetResponseAsync(messages, options, cancellationToken);

    /// <summary>
        /// Streams incremental updates for a chat completion request based on the provided messages and options.
        /// </summary>
        /// <param name="messages">The chat messages forming the conversation prompt sent to the model.</param>
        /// <param name="options">Optional parameters that control generation behavior for the request.</param>
        /// <param name="cancellationToken">Token to cancel the streaming operation.</param>
        /// <returns>An <see cref="IAsyncEnumerable{ChatResponseUpdate}"/> that yields incremental response updates until the completion or cancellation of the stream.</returns>
        public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IList<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken cancellationToken = default)
        => BuildClient().GetStreamingResponseAsync(messages, options, cancellationToken);

    /// <summary>
        /// Resolves a provider-specific service for the currently selected LLM client.
        /// </summary>
        /// <param name="serviceType">The type of the service to resolve.</param>
        /// <param name="serviceKey">An optional key to distinguish multiple registrations of the same service type.</param>
        /// <returns>The resolved service instance, or null if the service is not available.</returns>
        public object? GetService(Type serviceType, object? serviceKey = null)
        => BuildClient().GetService(serviceType, serviceKey);

    /// <summary>
/// Implements IDisposable for compatibility; the disposal implementation is intentionally empty.
/// </summary>
/// <remarks>
/// Provided so callers can dispose the instance without side effects. This method does not perform any resource cleanup.
/// </remarks>
public void Dispose() { }
}
