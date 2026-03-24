namespace ZettelWeb.Models;

/// <summary>A single LLM model entry from a provider's model list.</summary>
public record LlmModelInfo(string Id, string Name, long? ContextLength);

/// <summary>Available models grouped by provider.</summary>
public record AvailableModels(List<LlmModelInfo> OpenRouter, List<LlmModelInfo> Google);
