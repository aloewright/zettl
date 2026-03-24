using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.AI;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using OllamaSharp;
using OpenAI;
using System.ClientModel;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Scalar.AspNetCore;
using System.Text.Json;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using ZettelWeb;
using ZettelWeb.Background;
using ZettelWeb.Data;
using ZettelWeb.Health;
using ZettelWeb.Models;
using ZettelWeb.Services;
using ZettelWeb.Services.Publishing;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers()
    .AddJsonOptions(o =>
        o.JsonSerializerOptions.Converters.Add(
            new System.Text.Json.Serialization.JsonStringEnumConverter()));

// ── OpenAPI ────────────────────────────────────────────────
builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer((document, context, ct) =>
    {
        document.Info = new()
        {
            Title = "ZettelWeb API",
            Version = "v1",
            Description = "A self-hosted Zettelkasten knowledge management API with semantic search, " +
                          "multi-method capture, and AI-powered note discovery."
        };
        return Task.CompletedTask;
    });
});

// ── OpenTelemetry ────────────────────────────────────────
var otelEndpoint = builder.Configuration["Otel:Endpoint"];

builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource
        .AddService(ZettelTelemetry.ServiceName))
    .WithTracing(tracing =>
    {
        tracing
            .AddSource(ZettelTelemetry.ServiceName)
            .AddSource("Npgsql")
            .AddAspNetCoreInstrumentation()
            .AddHttpClientInstrumentation();

        if (!string.IsNullOrEmpty(otelEndpoint))
            tracing.AddOtlpExporter(o => o.Endpoint = new Uri(otelEndpoint));
    })
    .WithMetrics(metrics =>
    {
        metrics
            .AddMeter(ZettelTelemetry.ServiceName)
            .AddAspNetCoreInstrumentation()
            .AddHttpClientInstrumentation();

        if (!string.IsNullOrEmpty(otelEndpoint))
            metrics.AddOtlpExporter(o => o.Endpoint = new Uri(otelEndpoint));
    });

builder.Logging.AddOpenTelemetry(logging =>
{
    logging.IncludeScopes = true;
    logging.IncludeFormattedMessage = true;
    if (!string.IsNullOrEmpty(otelEndpoint))
    {
        logging.AddOtlpExporter(o => o.Endpoint = new Uri(otelEndpoint));
    }
});

var dataSourceBuilder = new NpgsqlDataSourceBuilder(
    builder.Configuration.GetConnectionString("DefaultConnection"));
dataSourceBuilder.UseVector();
var dataSource = dataSourceBuilder.Build();

builder.Services.AddDbContext<ZettelDbContext>(options =>
    options.UseNpgsql(dataSource, o => o.UseVector()));

var searchWeights = builder.Configuration.GetSection("Search").Get<SearchWeights>() ?? new SearchWeights();

builder.Services.AddSingleton<IEmbeddingQueue, ChannelEmbeddingQueue>();
builder.Services.AddSingleton<IEnrichmentQueue, ChannelEnrichmentQueue>();
builder.Services.AddSingleton<IUrlSafetyChecker, UrlSafetyChecker>();
builder.Services.AddScoped<INoteService>(sp =>
    new NoteService(
        sp.GetRequiredService<ZettelDbContext>(),
        sp.GetRequiredService<IEmbeddingQueue>(),
        sp.GetRequiredService<IEmbeddingGenerator<string, Embedding<float>>>(),
        sp.GetRequiredService<ILogger<NoteService>>()));
builder.Services.AddScoped<IImportService, ImportService>();
builder.Services.AddScoped<IExportService, ExportService>();
builder.Services.AddScoped<IGraphService, GraphService>();
builder.Services.AddScoped<IKbHealthService, KbHealthService>();
builder.Services.Configure<CaptureConfig>(builder.Configuration.GetSection("Capture"));
builder.Services.AddScoped<CaptureService>();
builder.Services.AddScoped<IDiscoveryService, DiscoveryService>();
builder.Services.Configure<TopicDiscoveryOptions>(
    builder.Configuration.GetSection("ContentGenerator:TopicDiscovery"));
builder.Services.AddScoped<ITopicDiscoveryService, TopicDiscoveryService>();
builder.Services.AddScoped<ISearchService>(sp =>
    new SearchService(
        sp.GetRequiredService<ZettelDbContext>(),
        sp.GetRequiredService<IEmbeddingGenerator<string, Embedding<float>>>(),
        searchWeights,
        sp.GetRequiredService<ILogger<SearchService>>()));

// ── Cloudflare AI Gateway ─────────────────────────────────
// When set, all OpenAI API calls are routed through the gateway for
// caching, rate limiting, and observability.
// Format: https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_name}
var aiGatewayUrl = builder.Configuration["Cloudflare:AiGatewayUrl"]?.TrimEnd('/');

OpenAIClientOptions BuildOpenAiOptions() =>
    string.IsNullOrEmpty(aiGatewayUrl)
        ? new OpenAIClientOptions()
        : new OpenAIClientOptions { Endpoint = new Uri($"{aiGatewayUrl}/openai") };

var embeddingProvider = builder.Configuration["Embedding:Provider"] ?? "openai";
var embeddingModel = builder.Configuration["Embedding:Model"] ?? "text-embedding-3-large";

if (string.Equals(embeddingProvider, "ollama", StringComparison.OrdinalIgnoreCase))
{
    var ollamaUri = builder.Configuration["Embedding:OllamaUrl"] ?? "http://localhost:11434";
    var ollamaTimeoutSeconds = builder.Configuration.GetValue("Embedding:HttpTimeoutSeconds", 300);
    var ollamaHttpClient = new HttpClient
    {
        BaseAddress = new Uri(ollamaUri),
        Timeout = TimeSpan.FromSeconds(ollamaTimeoutSeconds)
    };
    builder.Services.AddSingleton<IEmbeddingGenerator<string, Embedding<float>>>(
        new OllamaApiClient(ollamaHttpClient, embeddingModel));
}
else
{
    var apiKey = builder.Configuration["Embedding:ApiKey"] ?? "";
    builder.Services.AddSingleton<IEmbeddingGenerator<string, Embedding<float>>>(
        new OpenAIClient(new ApiKeyCredential(apiKey), BuildOpenAiOptions())
            .GetEmbeddingClient(embeddingModel)
            .AsIEmbeddingGenerator());
}

builder.Services.AddHostedService<EmbeddingBackgroundService>();

builder.Services.AddHttpClient("Enrichment");
builder.Services.Configure<ResearchOptions>(builder.Configuration.GetSection(ResearchOptions.SectionName));
builder.Services.AddHttpClient("BraveSearch", c => c.Timeout = TimeSpan.FromSeconds(15));  // C3: explicit timeout
builder.Services.AddHttpClient("Arxiv", c => c.Timeout = TimeSpan.FromSeconds(15));         // C3: explicit timeout
builder.Services.AddSingleton<IWebSearchClient, BraveSearchClient>();
builder.Services.AddSingleton<IArxivClient, ArxivApiClient>();
builder.Services.AddScoped<IResearchAgentService, ResearchAgentService>();
builder.Services.AddSingleton<IResearchExecutionQueue, ChannelResearchExecutionQueue>();
builder.Services.AddHostedService<ResearchExecutionBackgroundService>();
builder.Services.AddHostedService<EnrichmentBackgroundService>();

// ── Content Generation LLM (IChatClient) ─────────────────────
builder.Services.Configure<ContentGenerationOptions>(
    builder.Configuration.GetSection(ContentGenerationOptions.SectionName));

// AppSettingsCache holds the live model preference; updated at runtime via /api/settings/model.
var appSettingsCache = new ZettelWeb.Services.AppSettingsCache();
builder.Services.AddSingleton(appSettingsCache);

// DynamicChatClient reads from AppSettingsCache on every call so model changes take
// effect immediately without a restart. Falls back to ContentGeneration:* appsettings.
var cgDefaultProvider = builder.Configuration["ContentGeneration:Provider"] ?? "openrouter";
var cgDefaultModel    = builder.Configuration["ContentGeneration:Model"] ?? "";
var openRouterApiKey  = builder.Configuration["OpenRouter:ApiKey"] ?? "";
var googleApiKey      = builder.Configuration["Google:ApiKey"] ?? "";
builder.Services.AddSingleton<IChatClient>(new ZettelWeb.Services.DynamicChatClient(
    appSettingsCache, aiGatewayUrl ?? "", openRouterApiKey, googleApiKey,
    cgDefaultProvider, cgDefaultModel));

builder.Services.AddHttpClient("Models", c => c.Timeout = TimeSpan.FromSeconds(15));
builder.Services.AddScoped<IContentGenerationService, ContentGenerationService>();

// ── Publishing services ────────────────────────────────────
builder.Services.Configure<PublishingOptions>(
    builder.Configuration.GetSection(PublishingOptions.SectionName));
builder.Services.AddHttpClient("GitHub", c => c.Timeout = TimeSpan.FromSeconds(15));
builder.Services.AddHttpClient("Publer", c => c.Timeout = TimeSpan.FromSeconds(30));
builder.Services.AddKeyedScoped<IPublishingService, GitHubPublishingService>("blog");
builder.Services.AddKeyedScoped<IPublishingService, PublerPublishingService>("social");

// ── Telegram outbound notifications ───────────────────────
var telegramToken = builder.Configuration["Capture:TelegramBotToken"];
if (!string.IsNullOrEmpty(telegramToken))
{
    builder.Services.AddHttpClient("Telegram", c => c.Timeout = TimeSpan.FromSeconds(10));
    builder.Services.AddSingleton<ITelegramNotifier, TelegramNotifier>();
}
else
{
    builder.Services.AddSingleton<ITelegramNotifier, NullTelegramNotifier>();
}

if (string.Equals(
    builder.Configuration["ContentGeneration:Schedule:Blog:Enabled"], "true",
    StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddHostedService<BlogContentScheduler>();
}

if (string.Equals(
    builder.Configuration["ContentGeneration:Schedule:Social:Enabled"], "true",
    StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddHostedService<SocialContentScheduler>();
}

// ── Kinde JWT Authentication ───────────────────────────────
var kindeDomain = builder.Configuration["Kinde:Domain"] ?? "";
var kindeAudience = builder.Configuration["Kinde:Audience"] ?? "";

if (!string.IsNullOrEmpty(kindeDomain))
{
    builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddJwtBearer(options =>
        {
            options.Authority = kindeDomain;
            options.Audience = kindeAudience;
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = kindeDomain,
                ValidateAudience = !string.IsNullOrEmpty(kindeAudience),
                ValidateLifetime = true,
            };
        });
    builder.Services.AddAuthorization();
}

builder.Services.AddHealthChecks()
    .AddCheck<DatabaseHealthCheck>("database")
    .AddCheck<EmbeddingHealthCheck>("embedding");

var corsOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        if (corsOrigins is ["*"])
            policy.AllowAnyOrigin();
        else if (corsOrigins.Length > 0)
            policy.WithOrigins(corsOrigins);

        policy.AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("capture", limiter =>
    {
        limiter.PermitLimit = 10;
        limiter.Window = TimeSpan.FromMinutes(1);
    });
    options.OnRejected = async (context, _) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        await context.HttpContext.Response.WriteAsync("Rate limit exceeded", _);
    };
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ZettelDbContext>();
    db.Database.Migrate();

    var dimensions = app.Configuration.GetValue<int>("Embedding:Dimensions");
    if (dimensions > 0 && dimensions <= 4096)
    {
#pragma warning disable EF1003 // Intentional raw SQL for DDL — see safety comment in MigrationHandler
        db.Database.ExecuteSqlRaw(
            $"CREATE INDEX IF NOT EXISTS idx_notes_embedding_hnsw " +
            $"ON \"Notes\" USING hnsw ((\"Embedding\"::vector({dimensions})) vector_cosine_ops) " +
            $"WHERE \"Embedding\" IS NOT NULL;");
#pragma warning restore EF1003
    }

    // Populate the in-memory AppSettingsCache from the database.
    var storedSettings = db.AppSettings.ToList();
    appSettingsCache.Load(storedSettings);
}

var publishingOpts = app.Services.GetRequiredService<IOptions<PublishingOptions>>().Value;
var startupLogger = app.Services.GetRequiredService<ILogger<Program>>();
startupLogger.LogInformation(
    "Publishing — GitHub configured: {GitHub} (token present: {Token}, owner: '{Owner}', repo: '{Repo}'), Publer configured: {Publer} (key present: {Key}, accounts: {Accounts})",
    publishingOpts.GitHub.IsConfigured,
    !string.IsNullOrEmpty(publishingOpts.GitHub.Token),
    publishingOpts.GitHub.Owner,
    publishingOpts.GitHub.Repo,
    publishingOpts.Publer.IsConfigured,
    !string.IsNullOrEmpty(publishingOpts.Publer.ApiKey),
    publishingOpts.Publer.Accounts.Count);

app.UseCors();
app.UseRateLimiter();

if (!string.IsNullOrEmpty(kindeDomain))
{
    app.UseAuthentication();
    app.UseAuthorization();
    app.MapControllers().RequireAuthorization();
}
else
{
    app.MapControllers();
}

app.MapOpenApi();
app.MapScalarApiReference(options =>
{
    options.WithTitle("ZettelWeb API")
           .WithTheme(ScalarTheme.Mars);
});
app.MapHealthChecks("/health", new()
{
    ResponseWriter = async (context, report) =>
    {
        context.Response.ContentType = "application/json";
        var result = new
        {
            status = report.Status.ToString(),
            entries = report.Entries.ToDictionary(
                e => e.Key,
                e => new
                {
                    status = e.Value.Status.ToString(),
                    description = e.Value.Description,
                    data = e.Value.Data
                })
        };
        await JsonSerializer.SerializeAsync(context.Response.Body, result,
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
    }
});

app.Run();
