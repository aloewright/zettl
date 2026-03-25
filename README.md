# PostPilot (Zettel)

A personal Zettelkasten knowledge management app with AI-powered
semantic search and automated content generation. Capture notes from
the web, email, or Telegram; find connections between ideas using
meaning-based search; and automatically generate blog posts and social
media drafts from your knowledge graph.

Built on **Cloudflare Workers + D1 + Vectorize + R2 + AI Gateway**, with a
React frontend served as Static Assets. Authentication is handled by
Cloudflare Access (Google OAuth -- no separate auth service needed).

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [AI Gateway](#ai-gateway)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Running Tests](#running-tests)
- [Project Structure](#project-structure)
- [License](#license)

---

## Features

- **Semantic search** -- Hybrid search combining vector similarity (Perplexity embeddings via AI Gateway + Vectorize)
  and SQLite full-text ranking; tunable weights
- **Zettelkasten workflow** -- Permanent notes, fleeting notes (quick capture), structure
  notes (organising), and source notes (with bibliography metadata)
- **Multiple capture methods** -- Web UI, email (via Cloudflare capture queue), or Telegram bot
- **Knowledge graph** -- Visual graph of note relationships and backlinks
- **Backlinks** -- Wiki-style `[[Title]]` linking between notes with automatic backlink detection
- **Related notes** -- AI-powered discovery of semantically similar notes and duplicate detection
- **URL enrichment** -- Automatically fetches metadata from URLs found in notes (queued async)
- **Import/export** -- Import plain `.md` files or Notion-compatible markdown exports; export
  all notes as JSON
- **Version history** -- Tracks snapshots of note changes
- **Tag system** -- Full-text autocomplete and filtering
- **Readwise sync** -- Bidirectional highlight sync with Readwise Reader
- **Automated content generation** -- Cron-scheduled pipeline (Monday blog, daily social)
  that mines your knowledge graph and generates drafts in your voice for human review
- **Publishing** -- Send approved pieces to GitHub (Astro blog) or Publer (social)
- **Autonomous research agent** -- Analyses KB gaps, executes web research via
  Perplexity (AI Gateway `research_gen` route), synthesises findings, queues
  results as fleeting notes for inbox triage. Approving an agenda auto-executes.
- **Media drive** -- Upload images, videos, audio, and files to Cloudflare R2;
  browse and filter uploads on the `/drive` page with inline previews and playback
- **Text-to-speech** -- TTS via AI Gateway `audio_gen` dynamic route (unified billing)
- **Speech-to-text** -- Audio transcription via AI Gateway `stt_gen` dynamic route
- **KB health dashboard** -- Embedding coverage, orphan detection, cluster analysis,
  AI-powered note splitting and summarisation
- **Cloudflare Access auth** -- Google OAuth gate managed by Cloudflare Access;
  no separate auth service required

---

## Architecture

```
Browser --> Cloudflare Access (Google OAuth)
        --> Cloudflare Worker (zettl)
               |  Hono router (src/worker/)
               |
        +------+------+------------------+
        |      |      |                  |
   D1 (SQLite) |  R2 (zettel-media)  AI Gateway (x) — unified billing
   (notes,     |  (uploads: images,  +-------------------------------+
    tags,       |   video, audio,    | text_gen       (LLM)          |
    versions)   |   files)           | research_gen   (Perplexity)   |
        |       |                    | ai_embed       (embeddings)   |
   Vectorize    |                    | audio_gen      (TTS)          |
   (zettel-notes,                    | stt_gen        (STT)          |
    2056-dim cosine)                 | image_gen      (images)       |
        |                            +-------------------------------+
   Cloudflare Queues
   +-- zettel-embeddings
   +-- zettel-enrichment

Capture:
  Email / Telegram --> zettel-capture-queue worker --> Worker /api/capture/*

Cron (Workers Triggers):
  Monday 09:00 UTC  --> blog content generation
  Daily  09:00 UTC  --> social content generation

Static assets: React SPA bundled and served via Cloudflare Static Assets binding
```

---

## AI Gateway

**All AI requests** route through **Cloudflare AI Gateway** (`gateway: x`) with
**unified billing** — no direct model calls, no provider API keys in the worker.
The gateway handles provider selection, logging, caching, rate limiting, and cost tracking.

| Route           | Endpoint pattern                | Purpose                                      |
| --------------- | ------------------------------- | -------------------------------------------- |
| `text_gen`      | `/compat/chat/completions`      | LLM chat completions                         |
| `research_gen`  | `/compat/chat/completions`      | Web research (Perplexity sonar-pro)          |
| `ai_embed`      | `/compat/embeddings`            | Text embeddings (pplx-embed-context-v1-4b, 2056-dim) |
| `audio_gen`     | `/compat/audio/speech`          | Text-to-speech                               |
| `stt_gen`       | `/compat/audio/transcriptions`  | Speech-to-text                               |
| `image_gen`     | (configured in gateway)         | Image generation                             |

### Auth

Each request sends a single auth header:

- **`cf-aig-authorization: Bearer <CF_AIG_TOKEN>`** -- AI Gateway token for
  unified billing. The gateway selects providers and models based on its
  dynamic route configuration.

The app sends `model: "dynamic/<route>"` (e.g., `dynamic/text_gen`) and the
gateway resolves the actual provider and model.

---

## Deployment

The app runs as a single **Cloudflare Worker** (`src/worker/`) that serves the React
frontend from Static Assets and exposes the REST API.

### Prerequisites

- Cloudflare account with Workers, D1, Vectorize, R2, AI Gateway enabled
- Node.js 20+ and `npm`
- Wrangler CLI: `npm install -g wrangler`

### 1 -- Create Cloudflare resources

```bash
# D1 database
npx wrangler d1 create zettel

# Vectorize index (2056 dims for pplx-embed-context-v1-4b)
npx wrangler vectorize create zettel-notes --dimensions=2056 --metric=cosine

# R2 bucket (media uploads)
npx wrangler r2 bucket create zettel-media

# Queues
npx wrangler queues create zettel-embeddings
npx wrangler queues create zettel-enrichment
```

Copy the IDs printed by each command into `src/worker/wrangler.toml`.

### 2 -- Store secrets

Secrets are stored in a Cloudflare Secrets Store and/or via `wrangler secret put`:

```bash
# AI Gateway auth (required for unified billing)
npx wrangler secret put CF_AIG_TOKEN

# Optional integrations
npx wrangler secret put BRAVE_API_KEY           # Research agent web search
npx wrangler secret put READWISE_ACCESS_TOKEN   # Readwise sync
npx wrangler secret put TELEGRAM_BOT_TOKEN      # Telegram capture
```

### 3 -- Run database migrations

```bash
cd src/worker
npx wrangler d1 migrations apply zettel --remote
```

### 4 -- Build and deploy

```bash
# Build the React frontend first
cd src/zettel-web-ui && npm ci && npm run build && cd -

# Deploy the worker + static assets
cd src/worker && npx wrangler deploy
```

### 5 -- Configure Cloudflare Access

In the Cloudflare Dashboard > Access > Applications, create a self-hosted
application for your worker domain and add a Google OAuth identity provider.
This gates the entire app behind your Google account -- no additional auth
configuration is needed in the app.

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
| `CF_AIG_TOKEN`              | Wrangler secret | Yes     | Cloudflare AI Gateway token for unified billing  |
| `BRAVE_API_KEY`             | Secrets Store  | No       | Brave Search API key for research agent          |
| `READWISE_ACCESS_TOKEN`     | Secrets Store  | No       | Readwise Reader access token                     |
| `TELEGRAM_BOT_TOKEN`        | Secrets Store  | No       | Telegram bot token for capture                   |
| `CAPTURE_WEBHOOK_SECRET`    | Secrets Store  | No       | Shared secret for webhook capture endpoints      |

### Environment variables

| Variable              | Description                                                        |
| --------------------- | ------------------------------------------------------------------ |
| `CF_AI_GATEWAY_URL`   | AI Gateway base URL (`https://gateway.ai.cloudflare.com/v1/...`)   |

### Search weights

Tunable in `src/worker/src/types.ts`:

| Constant                 | Default | Description                                 |
| ------------------------ | ------- | ------------------------------------------- |
| `semanticWeight`         | `0.7`   | Vectorize similarity weight in hybrid search |
| `fullTextWeight`         | `0.3`   | D1 FTS weight in hybrid search              |
| `minimumSimilarity`      | `0.5`   | Minimum cosine similarity threshold         |
| `minimumHybridScore`     | `0.1`   | Minimum combined score to include a result  |

---

## API Reference

See [docs/API_REFERENCE.md](docs/API_REFERENCE.md) for full endpoint documentation.

### Notes

| Method   | Endpoint                        | Description                                 |
| -------- | ------------------------------- | ------------------------------------------- |
| `POST`   | `/api/notes`                    | Create a note                               |
| `GET`    | `/api/notes`                    | List notes (supports pagination, filtering) |
| `GET`    | `/api/notes/{id}`               | Get a note by ID                            |
| `PUT`    | `/api/notes/{id}`               | Update a note                               |
| `DELETE` | `/api/notes/{id}`               | Delete a note                               |
| `POST`   | `/api/notes/check-duplicate`    | Check for duplicate content                 |
| `POST`   | `/api/notes/re-embed`           | Re-embed all notes                          |
| `GET`    | `/api/notes/{id}/backlinks`     | Get wiki-style backlinks                    |
| `GET`    | `/api/notes/{id}/versions`      | Get version history                         |
| `POST`   | `/api/notes/{id}/promote`       | Convert fleeting to permanent               |
| `POST`   | `/api/notes/{fleetingId}/merge` | Merge fleeting into permanent               |
| `GET`    | `/api/notes/discover`           | Discover notes (random, orphans, today)     |

### Search

| Method | Endpoint                              | Description              |
| ------ | ------------------------------------- | ------------------------ |
| `GET`  | `/api/search?q={query}`               | Hybrid search (default)  |
| `GET`  | `/api/search?q={query}&type=fulltext` | Full-text only           |
| `GET`  | `/api/search?q={query}&type=semantic` | Semantic only            |
| `GET`  | `/api/search/{noteId}/related`        | Find related notes       |

### Content Generation

| Method   | Endpoint                                 | Description                                 |
| -------- | ---------------------------------------- | ------------------------------------------- |
| `POST`   | `/api/content/generate`                  | Trigger a manual generation run             |
| `POST`   | `/api/content/generate/from-note/{id}`   | Generate from a specific seed note          |
| `GET`    | `/api/content/generations`               | List generation runs (paginated)            |
| `GET`    | `/api/content/generations/{id}`          | Get a run with its content pieces           |
| `POST`   | `/api/content/generations/{id}/regenerate` | Regenerate all pieces                     |
| `GET`    | `/api/content/pieces`                    | List pieces (filter by medium, status)      |
| `GET`    | `/api/content/pieces/{id}`               | Get a single piece                          |
| `PUT`    | `/api/content/pieces/{id}/approve`       | Approve a piece                             |
| `PUT`    | `/api/content/pieces/{id}/reject`        | Reject a piece                              |
| `POST`   | `/api/content/pieces/{id}/send-to-draft` | Send to GitHub (blog) or Publer (social)    |
| `GET`    | `/api/content/pieces/{id}/export`        | Download piece as `.md`                     |
| `PUT`    | `/api/content/pieces/{id}/description`   | Update piece description                    |
| `PUT`    | `/api/content/pieces/{id}/tags`          | Update piece tags                           |
| `GET`    | `/api/content/schedule`                  | Get schedule settings                       |
| `PUT`    | `/api/content/schedule/blog`             | Update blog schedule                        |
| `PUT`    | `/api/content/schedule/social`           | Update social schedule                      |

### Text-to-Speech / Speech-to-Text

| Method | Endpoint             | Description                                    |
| ------ | -------------------- | ---------------------------------------------- |
| `POST` | `/api/tts`           | Text-to-speech (returns `audio/mpeg`)          |
| `POST` | `/api/tts/transcribe`| Speech-to-text (accepts audio binary or base64)|
| `GET`  | `/api/tts/voices`    | List available voices                          |

### Knowledge Base Health

| Method | Endpoint                                          | Description                                    |
| ------ | ------------------------------------------------- | ---------------------------------------------- |
| `GET`  | `/api/kb-health/overview`                         | Scorecard, orphans, clusters, unused seeds     |
| `GET`  | `/api/kb-health/orphan/{id}/suggestions`          | Semantic suggestions for an orphan             |
| `POST` | `/api/kb-health/orphan/{id}/link`                 | Insert a wikilink into an orphan               |
| `GET`  | `/api/kb-health/missing-embeddings`               | List notes missing embeddings                  |
| `POST` | `/api/kb-health/missing-embeddings/{id}/requeue`  | Requeue a single note for embedding            |
| `POST` | `/api/kb-health/missing-embeddings/requeue-all`   | Bulk requeue all pending/stale/failed notes    |
| `GET`  | `/api/kb-health/large-notes`                      | List notes exceeding size threshold            |
| `POST` | `/api/kb-health/large-notes/{id}/summarize`       | AI-powered summarisation                       |
| `POST` | `/api/kb-health/large-notes/{id}/split-suggestions`| AI split analysis                             |
| `POST` | `/api/kb-health/large-notes/{id}/apply-split`     | Create notes from split suggestions            |

### Research Agent

| Method | Endpoint                                      | Description                                  |
| ------ | --------------------------------------------- | -------------------------------------------- |
| `POST` | `/api/research/trigger`                       | Analyse KB and generate research agenda      |
| `POST` | `/api/research/agenda/{id}/approve`           | Approve agenda and start execution           |
| `GET`  | `/api/research/findings`                      | List pending findings                        |
| `POST` | `/api/research/findings/{id}/accept`          | Accept finding (creates fleeting note)       |
| `POST` | `/api/research/findings/{id}/dismiss`         | Dismiss a finding                            |

### Voice Configuration

| Method   | Endpoint                   | Description                          |
| -------- | -------------------------- | ------------------------------------ |
| `GET`    | `/api/voice/examples`      | List writing examples                |
| `POST`   | `/api/voice/examples`      | Add a writing example                |
| `DELETE` | `/api/voice/examples/{id}` | Delete a writing example             |
| `GET`    | `/api/voice/configs`       | List voice configs                   |
| `POST`   | `/api/voice/configs`       | Create a voice config                |
| `PUT`    | `/api/voice/configs/{id}`  | Update a voice config                |
| `DELETE` | `/api/voice/configs/{id}`  | Delete a voice config                |

### Media Upload / Drive

| Method | Endpoint                      | Description                                    |
| ------ | ----------------------------- | ---------------------------------------------- |
| `POST` | `/api/upload`                 | Upload a file (multipart form, 50 MB max)      |
| `GET`  | `/api/upload/files`           | List uploaded files (filter: `?type=image`)     |
| `GET`  | `/media/{key}`                | Serve a file from R2 (immutable cache)         |

### Other

| Method | Endpoint                | Description          |
| ------ | ----------------------- | -------------------- |
| `GET`  | `/api/tags?q={prefix}`  | Autocomplete tags    |
| `GET`  | `/api/graph`            | Knowledge graph data |
| `GET`  | `/api/discover`         | Discover notes       |
| `GET`  | `/api/settings`         | Get LLM settings     |
| `PUT`  | `/api/settings/model`   | Update LLM provider  |
| `POST` | `/api/generate/stream`  | Streaming LLM chat   |
| `GET`  | `/health`               | Service health check |

---

## Running Tests

**Frontend (Vitest):**
```bash
cd src/zettel-web-ui && npm test
```

**Backend (worker type-check):**
```bash
cd src/worker && npx tsc --noEmit
```

---

## Project Structure

```
zettl/
  src/
    worker/                 # Cloudflare Worker -- Hono API backend
      src/
        index.ts            # Entry point: fetch + queue + scheduled handlers
        middleware/auth.ts   # Cloudflare Access JWT validation
        routes/              # One file per route group (notes, search, content, ...)
        services/            # LLM, audio (TTS/STT), embeddings, search
          llm.ts             # AI Gateway text_gen / research_gen routes
          audio.ts           # AI Gateway audio_gen / stt_gen routes
          embeddings.ts      # AI Gateway ai_embed route (pplx-embed-context-v1-4b)
          search.ts          # Hybrid search (Vectorize + D1 FTS)
        queues/              # Embedding + enrichment queue consumers
        db/                  # Drizzle ORM schema + D1 client
        cron/                # Content generation cron handler
      wrangler.toml          # Worker config: D1, Vectorize, R2, Queues
    zettel-web-ui/           # React frontend (Vite + Tailwind + shadcn/ui)
      src/
        api/                 # Typed fetch wrappers for each backend endpoint
        components/          # UI components (header, note editor, graph, ...)
        pages/               # Route pages
        hooks/               # React Query hooks
  voice-service/             # Optional Python voice microservice
  docs/                      # Design docs, API reference, compound learnings
```

---

## License

MIT
