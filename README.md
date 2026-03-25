# Post

A personal knowledge management app built on the Zettelkasten method with
AI-powered semantic search, automated content generation, and integrated
publishing. Capture notes from the web, email, or Telegram; find connections
between ideas; generate blog posts and social media drafts from your knowledge
graph; and publish directly to Substack.

Built on **Cloudflare Workers + D1 + Vectorize + R2 + AI Gateway + Browser Rendering**,
with a React frontend served as Static Assets. Authentication via Cloudflare Access
(Google OAuth). External tool integrations powered by **Composio MCP**.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [AI Gateway](#ai-gateway)
- [Composio Integration](#composio-integration)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Running Tests](#running-tests)
- [Project Structure](#project-structure)
- [License](#license)

---

## Features

### Knowledge Management
- **Zettelkasten workflow** -- Permanent, fleeting (quick capture), structure (organising),
  and source notes (with bibliography metadata)
- **Semantic search** -- Hybrid search combining vector similarity (Perplexity embeddings,
  2056-dim via AI Gateway + Vectorize) and SQLite full-text ranking; tunable weights
- **Knowledge graph** -- Visual graph of note relationships and backlinks
- **Wikilinks** -- `[[Title]]` linking between notes with automatic backlink detection
  and hover previews
- **Related notes** -- AI-powered discovery of semantically similar notes and duplicates
- **Tag system** -- Full-text autocomplete, filtering, and AI auto-tagging on import
- **Version history** -- Tracks snapshots of note changes

### Capture & Import
- **Multiple capture methods** -- Web UI, email (via Cloudflare capture queue), or Telegram bot
- **Import/export** -- Import `.md` files (plain, Notion, Readwise formats); export as JSON
- **AI auto-tagging** -- Imported notes without tags get AI-generated tags automatically
- **URL enrichment** -- Async metadata extraction from URLs found in notes
- **Readwise sync** -- Highlight sync with Readwise Reader

### Content Generation & Publishing
- **Automated content pipeline** -- Cron-scheduled (Monday blog, daily social) pipeline
  mines your knowledge graph and generates drafts in your voice for review
- **Voice configuration** -- Customise tone, audience, and provide writing examples
- **Substack publishing** -- Direct blog post publishing via Cloudflare Browser Rendering
  (headless browser login + post creation)
- **Markdown export** -- Download approved pieces as `.md` files

### AI Chat & Tools
- **Floating AI chat** -- Streaming chat window with voice input and file upload (image/PDF context)
- **Composio MCP integration** -- 500+ external tool integrations available during AI chat
  (search, email, calendar, code, etc.) via Composio's remote MCP server
- **Connected services** -- OAuth authentication for Google (Gmail), LinkedIn, YouTube,
  GitHub, and Resend managed in settings via Composio

### Research Agent
- **Autonomous research** -- Analyses KB gaps, generates research agenda, executes
  web research via Perplexity (`research_gen` route), synthesises findings, queues
  results as fleeting notes for inbox triage
- **Approval workflow** -- Review agenda before execution; block individual tasks

### Media & Audio
- **Media drive** -- Upload images, videos, audio, and files to R2; browse and filter
  on `/drive` with inline previews and playback
- **Text-to-speech** -- TTS via AI Gateway `audio_gen` route
- **Speech-to-text** -- Audio transcription via AI Gateway `stt_gen` route

### System
- **KB health dashboard** -- Embedding coverage, orphan detection, cluster analysis,
  AI-powered note splitting and summarisation
- **Rich text editor** -- BlockNote editor with file uploads, slash commands
- **Theme support** -- Light, dark, and system themes
- **Cloudflare Access auth** -- Google OAuth gate; no separate auth service

---

## Architecture

```
Browser --> Cloudflare Access (Google OAuth)
        --> Cloudflare Worker (zettl)
               |  Hono router
               |
        +------+------+------------------+-------------------+
        |      |      |                  |                   |
   D1 (SQLite) |  R2 (zettel-media)  AI Gateway "x"    Composio MCP
   (notes,     |  (media uploads)    (unified billing)  (remote tools)
    tags,       |                    +-----------------+
    versions,   |                    | text_gen (LLM)  |
    content,    |                    | research_gen    |
    research)   |                    | ai_embed        |
        |       |                    | audio_gen (TTS) |
   Vectorize    |                    | stt_gen   (STT) |
   (zettel-notes,                    +-----------------+
    2056-dim cosine)
        |
   Cloudflare Queues
   +-- zettel-embeddings    (async embedding pipeline)
   +-- zettel-enrichment    (async URL metadata extraction)

Browser Rendering: Headless Chromium for Substack publishing

Cron (Workers Triggers):
  Monday 09:00 UTC  --> blog content generation
  Daily  09:00 UTC  --> social content generation

Static assets: React SPA served via Cloudflare Static Assets binding
```

---

## AI Gateway

**All AI requests** route through **Cloudflare AI Gateway** (`gateway: x`) with
**unified billing**. No direct model calls, no provider API keys in the worker.
The gateway handles provider selection, logging, caching, rate limiting, and cost.

| Route           | Endpoint pattern                          | Purpose                                      |
| --------------- | ----------------------------------------- | -------------------------------------------- |
| `text_gen`      | `/dynamic/text_gen/chat/completions`      | LLM chat completions and content generation  |
| `research_gen`  | `/dynamic/research_gen/chat/completions`  | Web research (Perplexity)                    |
| `ai_embed`      | `/compat/embeddings`                      | Text embeddings (pplx-embed-context-v1-4b, 2056-dim) |
| `audio_gen`     | `/compat/audio/speech`                    | Text-to-speech                               |
| `stt_gen`       | `/compat/audio/transcriptions`            | Speech-to-text                               |

### Auth

`cf-aig-authorization: Bearer <CF_AIG_TOKEN>` -- a wrangler secret (plain string)
read directly from `env.CF_AIG_TOKEN`. The gateway resolves providers and models
from `model: "dynamic/<route>"`.

### Key files

| File | Purpose |
|------|---------|
| `services/gateway.ts` | Centralized gateway config, `gatewayFetch()`, `gatewayHeaders()` |
| `services/llm.ts` | `chatCompletion()`, `chatCompletionStream()`, `researchCompletion()` |
| `services/embeddings.ts` | `generateEmbeddingAI()` (2056-dim Perplexity embeddings) |
| `services/audio.ts` | `textToSpeech()`, `speechToText()` |
| `services/mcp.ts` | Composio MCP client with SSE response parsing |

---

## Composio Integration

External tool integrations are powered by **Composio** via a remote MCP server.

- **MCP URL**: `https://connect.composio.dev/mcp`
- **Consumer key**: Stored in the worker code (not a secret -- it's a public consumer key)
- **Protocol**: JSON-RPC over HTTP with SSE responses

### Connected Services (Settings page)

Users authenticate with external services via Composio's OAuth flow:

| Service | Toolkit slug | Capabilities |
|---------|-------------|-------------|
| Google (Gmail) | `gmail` | Email, Calendar, Drive |
| LinkedIn | `linkedin` | Posts, connections |
| YouTube | `youtube` | Videos, channels |
| GitHub | `github` | Repos, issues, PRs |
| Resend | `resend` | Transactional email |

### AI Chat Tool Use

When Composio MCP is enabled in settings, the AI chat (`/api/generate/stream`)
fetches available tools, passes them as OpenAI function-call format, and
executes tool calls via MCP when the LLM requests them.

---

## Deployment

### Prerequisites

- Cloudflare account with Workers, D1, Vectorize, R2, AI Gateway, Browser Rendering
- Node.js 20+ and `npm`
- Wrangler CLI: `npm install -g wrangler`

### 1 -- Create Cloudflare resources

```bash
npx wrangler d1 create zettel
npx wrangler vectorize create zettel-notes --dimensions=2056 --metric=cosine
npx wrangler r2 bucket create zettel-media
npx wrangler queues create zettel-embeddings
npx wrangler queues create zettel-enrichment
```

Copy the IDs into `src/worker/wrangler.toml`.

### 2 -- Store secrets

```bash
# Required: AI Gateway auth for unified billing
npx wrangler secret put CF_AIG_TOKEN

# Optional integrations (stored in Cloudflare Secrets Store)
# Configure bindings in wrangler.toml [[secrets_store_secrets]]
```

### 3 -- Run database migrations

```bash
cd src/worker
npx wrangler d1 migrations apply zettel --remote
```

### 4 -- Build and deploy

```bash
cd src/zettel-web-ui && npm ci && npm run build && cd -
cd src/worker && npx wrangler deploy
```

### 5 -- Configure Cloudflare Access

Create a self-hosted application in Cloudflare Access for your worker domain
with a Google OAuth identity provider.

### Local development

```bash
# Terminal 1 -- Worker (hot reload)
cd src/worker && npx wrangler dev

# Terminal 2 -- Frontend dev server (proxies /api/* to localhost:8787)
cd src/zettel-web-ui && npm run dev
```

---

## Configuration

### Secrets

| Secret / Binding            | Type           | Required | Description                                      |
| --------------------------- | -------------- | -------- | ------------------------------------------------ |
| `CF_AIG_TOKEN`              | Wrangler secret | Yes     | AI Gateway token for unified billing (plain string) |
| `BRAVE_API_KEY`             | Secrets Store  | No       | Brave Search API key                             |
| `READWISE_ACCESS_TOKEN`     | Secrets Store  | No       | Readwise Reader access token                     |
| `TELEGRAM_BOT_TOKEN`        | Secrets Store  | No       | Telegram bot token for capture                   |
| `CAPTURE_WEBHOOK_SECRET`    | Secrets Store  | No       | Shared secret for webhook capture endpoints      |

### Environment variables

| Variable              | Description                                                        |
| --------------------- | ------------------------------------------------------------------ |
| `CF_AI_GATEWAY_URL`   | AI Gateway base URL (informational; actual URL is hardcoded in `gateway.ts`) |
| `CF_ACCESS_TEAM`      | Cloudflare Access team domain for JWT validation                   |

---

## API Reference

See [docs/API_REFERENCE.md](docs/API_REFERENCE.md) for full endpoint documentation.

### Notes

| Method   | Endpoint                        | Description                                 |
| -------- | ------------------------------- | ------------------------------------------- |
| `POST`   | `/api/notes`                    | Create a note                               |
| `GET`    | `/api/notes`                    | List notes (pagination, filtering)          |
| `GET`    | `/api/notes/{id}`               | Get a note by ID                            |
| `PUT`    | `/api/notes/{id}`               | Update a note                               |
| `DELETE` | `/api/notes/{id}`               | Delete a note                               |
| `POST`   | `/api/notes/re-embed`           | Re-embed all notes                          |
| `GET`    | `/api/notes/{id}/backlinks`     | Get wikilink backlinks                      |
| `GET`    | `/api/notes/{id}/versions`      | Get version history                         |
| `POST`   | `/api/notes/{id}/promote`       | Convert fleeting to permanent               |
| `GET`    | `/api/notes/discover`           | Discover notes (random, orphans, today)     |

### Search

| Method | Endpoint                              | Description              |
| ------ | ------------------------------------- | ------------------------ |
| `GET`  | `/api/search?q={query}`               | Hybrid search (default)  |
| `GET`  | `/api/search?q={query}&type=fulltext` | Full-text only           |
| `GET`  | `/api/search?q={query}&type=semantic` | Semantic only            |
| `GET`  | `/api/search/{noteId}/related`        | Find related notes       |

### Content Generation

| Method   | Endpoint                                   | Description                     |
| -------- | ------------------------------------------ | ------------------------------- |
| `POST`   | `/api/content/generate`                    | Trigger generation run          |
| `POST`   | `/api/content/generate/from-note/{id}`     | Generate from specific note     |
| `GET`    | `/api/content/generations`                 | List runs (paginated)           |
| `GET`    | `/api/content/generations/{id}`            | Get run with pieces             |
| `POST`   | `/api/content/generations/{id}/regenerate` | Regenerate all pieces           |
| `GET`    | `/api/content/pieces`                      | List pieces                     |
| `PUT`    | `/api/content/pieces/{id}/approve`         | Approve a piece                 |
| `PUT`    | `/api/content/pieces/{id}/reject`          | Reject a piece                  |
| `GET`    | `/api/content/pieces/{id}/export`          | Download as `.md`               |

### AI Chat

| Method | Endpoint               | Description                                         |
| ------ | ---------------------- | --------------------------------------------------- |
| `POST` | `/api/generate/stream` | Streaming LLM chat with optional MCP tool execution |

### Research Agent

| Method | Endpoint                              | Description                          |
| ------ | ------------------------------------- | ------------------------------------ |
| `POST` | `/api/research/trigger`               | Generate research agenda from KB     |
| `POST` | `/api/research/agenda/{id}/approve`   | Approve and auto-execute             |
| `GET`  | `/api/research/findings`              | List findings                        |
| `POST` | `/api/research/findings/{id}/accept`  | Accept (creates fleeting note)       |
| `POST` | `/api/research/findings/{id}/dismiss` | Dismiss finding                      |

### Audio

| Method | Endpoint        | Description                          |
| ------ | --------------- | ------------------------------------ |
| `POST` | `/api/tts`      | Text-to-speech (returns audio/mpeg)  |
| `GET`  | `/api/tts/voices` | List available voices              |
| `POST` | `/api/stt`      | Speech-to-text                       |

### Composio / MCP

| Method   | Endpoint                           | Description                          |
| -------- | ---------------------------------- | ------------------------------------ |
| `GET`    | `/api/composio/config`             | Get MCP enabled status               |
| `PUT`    | `/api/composio/config`             | Enable/disable MCP tools             |
| `GET`    | `/api/composio/connections`        | Check all service connection statuses |
| `POST`   | `/api/composio/auth-link`          | Generate OAuth redirect for service  |
| `GET`    | `/api/composio/tools`              | List available MCP tools             |
| `POST`   | `/api/composio/tools/call`         | Execute an MCP tool                  |

### Substack Publishing

| Method | Endpoint              | Description                          |
| ------ | --------------------- | ------------------------------------ |
| `GET`  | `/api/substack/config` | Get Substack configuration          |
| `PUT`  | `/api/substack/config` | Update credentials/subdomain        |
| `POST` | `/api/substack/publish` | Publish a note to Substack          |

### Media

| Method | Endpoint              | Description                          |
| ------ | --------------------- | ------------------------------------ |
| `POST` | `/api/upload`         | Upload file (multipart, 50 MB max)   |
| `GET`  | `/api/upload/files`   | List uploads (filter: `?type=image`) |
| `GET`  | `/media/{key}`        | Serve file from R2                   |

### Other

| Method | Endpoint                | Description          |
| ------ | ----------------------- | -------------------- |
| `GET`  | `/api/tags?q={prefix}`  | Autocomplete tags    |
| `GET`  | `/api/graph`            | Knowledge graph data |
| `GET`  | `/api/settings`         | Get app settings     |
| `GET`  | `/health`               | Service health check |

---

## Running Tests

```bash
# Frontend (Vitest)
cd src/zettel-web-ui && npm test

# Backend (type-check)
cd src/worker && npx tsc --noEmit
```

---

## Project Structure

```
zettl/
  src/
    worker/                    # Cloudflare Worker -- Hono API backend
      src/
        index.ts               # Entry: fetch + queue + scheduled handlers
        middleware/auth.ts      # Cloudflare Access JWT validation
        routes/                 # One file per route group
          notes.ts              # CRUD, re-embed, backlinks, versions
          search.ts             # Hybrid search (vector + FTS)
          content.ts            # Content generation + review pipeline
          research.ts           # Research agent (agenda, tasks, findings)
          generate.ts           # Streaming AI chat with MCP tool use
          composio.ts           # Composio connections + MCP proxy
          substack.ts           # Substack publishing via Browser Rendering
          voice.ts              # Voice config (tone, audience, examples)
          tts.ts / stt.ts       # Text-to-speech / Speech-to-text
          upload.ts             # Media upload to R2
          import-export.ts      # Import/export with auto-tagging
          capture.ts            # Webhook + Telegram capture
          ...
        services/               # Shared service layer
          gateway.ts            # AI Gateway config + fetch (single source of truth)
          llm.ts                # Chat completion, streaming, research
          embeddings.ts         # Vector embeddings (2056-dim)
          audio.ts              # TTS / STT
          mcp.ts                # Composio MCP client (SSE-aware)
          search.ts             # Hybrid search engine
          readwise.ts           # Readwise sync
        queues/                 # Async queue consumers
          embedding.ts          # Note embedding pipeline
          enrichment.ts         # URL metadata extraction
        db/                     # Drizzle ORM schema + D1 client
        cron/                   # Scheduled content generation
      wrangler.toml             # Worker config
    zettel-web-ui/              # React frontend
      src/
        api/                    # Typed API client functions
        components/             # UI (header, note editor, graph, AI chat, ...)
        pages/                  # Route pages (inbox, settings, drive, ...)
        hooks/                  # React Query hooks
  docs/                         # Design docs, API reference, compound learnings
```

---

## License

MIT
