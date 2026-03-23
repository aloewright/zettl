# Alex's Notes

A personal Zettelkasten knowledge management app with AI-powered
semantic search and automated content generation. Capture notes from
the web, email, or Telegram; find connections between ideas using
meaning-based search; and automatically generate blog posts and social
media drafts from your knowledge graph.

Built on **Cloudflare Workers + D1 + Vectorize + Workers AI**, with a
React frontend served as Static Assets. Authentication is handled by
Cloudflare Access (Google OAuth — no separate auth service needed).

![UI screenshot](./img/ui-screenshot.png)

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Running Tests](#running-tests)
- [Project Structure](#project-structure)
- [License](#license)

---

## Features

- **Semantic search** — Hybrid search combining vector similarity (Workers AI + Vectorize)
  and SQLite full-text ranking; tunable weights
- **Zettelkasten workflow** — Permanent notes, fleeting notes (quick capture), structure
  notes (organising), and source notes (with bibliography metadata)
- **Multiple capture methods** — Web UI, email (via Cloudflare capture queue), or Telegram bot
- **Knowledge graph** — Visual graph of note relationships and backlinks
- **Backlinks** — Wiki-style `[[Title]]` linking between notes with automatic backlink detection
- **Related notes** — AI-powered discovery of semantically similar notes and duplicate detection
- **URL enrichment** — Automatically fetches metadata from URLs found in notes (queued async)
- **Import/export** — Import plain `.md` files or Notion-compatible markdown exports; export
  all notes as JSON
- **Version history** — Tracks snapshots of note changes
- **Tag system** — Full-text autocomplete and filtering
- **Readwise sync** — Bidirectional highlight sync with Readwise Reader
- **Automated content generation** — Cron-scheduled pipeline (Monday blog, daily social)
  that mines your knowledge graph and generates drafts in your voice for human review
- **Publishing** — Send approved pieces to GitHub (Astro blog) or Publer (social)
- **Autonomous research agent** — Analyses KB gaps, queries Brave Search and Arxiv,
  synthesises findings, queues results as fleeting notes for inbox triage
- **Voice assistant** — In-browser voice interface powered by ElevenLabs TTS; speak a
  question, hear an answer synthesised from your notes
- **Cloudflare Access auth** — Google OAuth gate managed by Cloudflare Access;
  no separate auth service required

---

## Architecture

```
Browser → Cloudflare Access (Google OAuth)
        → Cloudflare Worker (zettl)
               │  Hono router (src/worker/)
               │
        ┌──────┼──────────────────────────────┐
        │      │                              │
   D1 (SQLite) Vectorize index          Workers AI
   (notes,     (zettel-notes,           (BGE embeddings,
    tags,       1536-dim cosine)         content gen via
    versions)                            OpenAI gateway)
        │
   Cloudflare Queues
   ├── zettel-embeddings  (async embed after save)
   └── zettel-enrichment  (URL metadata extraction)

Capture:
  Email / Telegram → zettel-capture-queue worker → Worker /api/capture/*

Cron (Workers Triggers):
  Monday 09:00 UTC  → blog content generation
  Daily  09:00 UTC  → social content generation

Static assets: React SPA bundled and served via Cloudflare Static Assets binding
```

---

## Deployment

The app runs as a single **Cloudflare Worker** (`src/worker/`) that serves the React
frontend from Static Assets and exposes the REST API — all within the Workers free
or paid tier.

### Prerequisites

- Cloudflare account with Workers, D1, Vectorize, and Workers AI enabled
- Node.js 20+ and `npm`
- Wrangler CLI: `npm install -g wrangler`

### 1 — Create Cloudflare resources

```bash
# D1 database
npx wrangler d1 create zettel

# Vectorize index (1536 dims for text-embedding-3-large)
npx wrangler vectorize create zettel-notes --dimensions=1536 --metric=cosine

# Queues
npx wrangler queues create zettel-embeddings
npx wrangler queues create zettel-enrichment
```

Copy the IDs printed by each command into `src/worker/wrangler.toml`.

### 2 — Store secrets

Secrets are stored in a Cloudflare Secrets Store (or via `wrangler secret put`):

```bash
npx wrangler secret put OPENAI_API_KEY   # required for embeddings + content gen
npx wrangler secret put BRAVE_API_KEY    # optional — research agent web search
npx wrangler secret put READWISE_ACCESS_TOKEN  # optional — Readwise sync
npx wrangler secret put ELEVENLABS_API_KEY     # optional — TTS voice assistant
npx wrangler secret put TELEGRAM_BOT_TOKEN     # optional — Telegram capture
```

### 3 — Run database migrations

```bash
cd src/worker
npx wrangler d1 migrations apply zettel --remote
```

### 4 — Build and deploy

```bash
# Build the React frontend first
cd src/zettel-web-ui && npm ci && npm run build && cd -

# Deploy the worker + static assets
cd src/worker && npx wrangler deploy
```

### 5 — Configure Cloudflare Access

In the Cloudflare Dashboard → Access → Applications, create a self-hosted
application for your worker domain and add a Google OAuth identity provider.
This gates the entire app behind your Google account — no additional auth
configuration is needed in the app.

### Local development

```bash
# Terminal 1 — Worker (hot reload)
cd src/worker && npx wrangler dev

# Terminal 2 — Frontend dev server (proxies /api/* to localhost:8787)
cd src/zettel-web-ui && npm run dev
```

---

## Configuration

All secrets are stored in the Cloudflare Secrets Store and bound to the worker
via `wrangler.toml`. No environment variables are used at runtime — secrets are
resolved with `await env.SECRET_NAME.get()`.

| Secret binding              | Required | Description                                        |
| --------------------------- | -------- | -------------------------------------------------- |
| `OPENAI_API_KEY`            | Yes      | OpenAI API key for embeddings + content generation |
| `BRAVE_API_KEY`             | No       | Brave Search API key for the research agent        |
| `READWISE_ACCESS_TOKEN`     | No       | Readwise Reader access token                       |
| `ELEVENLABS_API_KEY`        | No       | ElevenLabs API key for TTS voice assistant         |
| `TELEGRAM_BOT_TOKEN`        | No       | Telegram bot token for capture + notifications     |
| `CAPTURE_WEBHOOK_SECRET`    | No       | Shared secret for webhook capture endpoints        |
| `CF_AI_GATEWAY_URL`         | No       | Cloudflare AI Gateway URL for OpenAI routing       |

### Search weights

Tunable via worker environment in `wrangler.toml` (or hardcoded in `src/worker/src/types.ts`):

| Constant                 | Default | Description                                 |
| ------------------------ | ------- | ------------------------------------------- |
| `semanticWeight`         | `0.7`   | Vectorize similarity weight in hybrid search |
| `fullTextWeight`         | `0.3`   | D1 FTS weight in hybrid search              |
| `minimumSimilarity`      | `0.5`   | Minimum cosine similarity threshold         |
| `minimumHybridScore`     | `0.1`   | Minimum combined score to include a result  |

---

## API Reference

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

### Search

| Method | Endpoint                              | Description              |
| ------ | ------------------------------------- | ------------------------ |
| `GET`  | `/api/search?q={query}`               | Hybrid search (default)  |
| `GET`  | `/api/search?q={query}&type=fulltext` | Full-text only           |
| `GET`  | `/api/search?q={query}&type=semantic` | Semantic only            |
| `GET`  | `/api/search/{noteId}/related`        | Find related notes       |
| `GET`  | `/api/search/discover`                | Discover unrelated notes |

### Import / Export

| Method | Endpoint      | Description                                               |
| ------ | ------------- | --------------------------------------------------------- |
| `POST` | `/api/import` | Import `.md` files: `[{fileName, content}]` or `{notes}` |
| `GET`  | `/api/export` | Export all notes as JSON                                  |

### Content Generation

| Method   | Endpoint                                 | Description                                             |
| -------- | ---------------------------------------- | ------------------------------------------------------- |
| `POST`   | `/api/content/generate`                  | Trigger a manual generation run                         |
| `GET`    | `/api/content/generations`               | List generation runs (paginated)                        |
| `GET`    | `/api/content/generations/{id}`          | Get a run with its content pieces                       |
| `GET`    | `/api/content/pieces`                    | List pieces (filter by `medium`, `status`)              |
| `GET`    | `/api/content/pieces/{id}`               | Get a single piece                                      |
| `PUT`    | `/api/content/pieces/{id}/approve`       | Approve a piece                                         |
| `PUT`    | `/api/content/pieces/{id}/reject`        | Reject a piece                                          |
| `POST`   | `/api/content/pieces/{id}/send-to-draft` | Send approved piece to GitHub (blog) or Publer (social) |
| `GET`    | `/api/content/pieces/{id}/export`        | Download piece as a `.md` file                          |
| `PUT`    | `/api/content/pieces/{id}/description`   | Update piece description                                |
| `PUT`    | `/api/content/pieces/{id}/tags`          | Update piece tags                                       |
| `GET`    | `/api/content/schedule`                  | Get per-type schedule settings (blog + social)          |
| `PUT`    | `/api/content/schedule/blog`             | Update blog schedule settings                           |
| `PUT`    | `/api/content/schedule/social`           | Update social schedule settings                         |

### Voice Configuration

| Method   | Endpoint                   | Description                          |
| -------- | -------------------------- | ------------------------------------ |
| `GET`    | `/api/voice/examples`      | List writing examples                |
| `POST`   | `/api/voice/examples`      | Add a writing example                |
| `DELETE` | `/api/voice/examples/{id}` | Delete a writing example             |
| `GET`    | `/api/voice/config`        | Get style notes (filter by `medium`) |
| `PUT`    | `/api/voice/config`        | Set style notes for a medium (upsert)|

### Knowledge Base Health

| Method | Endpoint                                 | Description                                    |
| ------ | ---------------------------------------- | ---------------------------------------------- |
| `GET`  | `/api/kb-health/overview`                | Scorecard, orphans, clusters, unused seeds     |
| `GET`  | `/api/kb-health/orphan/{id}/suggestions` | Semantic connection suggestions for an orphan  |
| `POST` | `/api/kb-health/orphan/{id}/link`        | Insert a `[[wikilink]]` into an orphan note    |

### Research Agent

| Method | Endpoint                                      | Description                                                           |
| ------ | --------------------------------------------- | --------------------------------------------------------------------- |
| `POST` | `/api/research/trigger`                       | Analyse KB and generate a research agenda (returns agenda for review) |
| `POST` | `/api/research/agenda/{agendaId}/approve`     | Approve agenda and start execution (202 — runs in background)         |
| `GET`  | `/api/research/findings`                      | List pending findings awaiting review                                 |
| `POST` | `/api/research/findings/{findingId}/accept`   | Accept a finding — creates a fleeting note                            |
| `POST` | `/api/research/findings/{findingId}/dismiss`  | Dismiss a finding                                                     |

### Other

| Method | Endpoint                | Description          |
| ------ | ----------------------- | -------------------- |
| `GET`  | `/api/tags?q={prefix}`  | Autocomplete tags    |
| `GET`  | `/api/graph`            | Knowledge graph data |
| `GET`  | `/api/discovery/random` | Random notes         |
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

**ASP.NET Core backend (legacy):**
```bash
dotnet test
```

---

## Project Structure

```
zettl/
  src/
    worker/                 # Cloudflare Worker — Hono API backend
      src/
        index.ts            # Entry point: fetch + queue + scheduled handlers
        middleware/auth.ts  # Cloudflare Access JWT validation
        routes/             # One file per route group (notes, search, import-export, ...)
        services/           # Embeddings, ElevenLabs TTS, search, Readwise
        queues/             # Embedding + enrichment queue consumers
        db/                 # Drizzle ORM schema + D1 client
        cron/               # Content generation cron handler
      wrangler.toml         # Worker config: D1, Vectorize, AI, Queues, Static Assets
    zettel-web-ui/          # React frontend (Vite + Tailwind + shadcn/ui)
      src/
        api/                # Typed fetch wrappers for each backend endpoint
        components/         # UI components (header, note editor, graph, ...)
        pages/              # Route pages
        hooks/              # React Query hooks
    ZettelWeb/              # Legacy ASP.NET Core API (kept for reference)
    ZettelWeb.Tests/        # xUnit tests for the ASP.NET Core backend
  infra/
    cloudflare/
      capture-queue-worker/ # Standalone queue consumer for email/Telegram capture
  voice-service/            # Optional Python voice microservice (ElevenLabs TTS)
  docs/                     # Design docs and ADRs
```

---

## License

MIT
