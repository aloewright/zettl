# API Reference

Last Updated: 2026-03-24

---

## Base URL

```
https://postpilot.cc
```

All endpoints return `application/json` unless stated otherwise. All `DateTime` values are UTC ISO 8601 strings. All `/api/*` routes require Cloudflare Access authentication.

---

## Notes

### `POST /api/notes`
Create a new note.

**Body:**
```json
{
  "title": "string",
  "content": "string (HTML, max 500,000 chars)",
  "tags": ["string"],
  "status": "Permanent | Fleeting",
  "noteType": "Regular | Structure | Source",
  "sourceAuthor": "string?",
  "sourceTitle": "string?",
  "sourceUrl": "string?",
  "sourceYear": "string?",
  "sourceType": "string?"
}
```

**Response:** `201 Created` — note object.

---

### `GET /api/notes`
List notes with filtering and pagination.

**Query params:** `skip`, `take` (1–200, default 50), `status`, `tag`, `noteType`

**Response:** `200 OK` — `{ items: Note[], totalCount: int }`

---

### `GET /api/notes/{id}`
Get a note by ID.

**Response:** `200 OK` | `404 Not Found`

---

### `PUT /api/notes/{id}`
Update a note. Queues re-embedding if content changed.

**Response:** `200 OK` | `404 Not Found`

---

### `DELETE /api/notes/{id}`
Delete a note and its versions and tags.

**Response:** `204 No Content` | `404 Not Found`

---

### `GET /api/notes/inbox`
List fleeting notes.

### `GET /api/notes/inbox/count`
Count of fleeting notes.

### `POST /api/notes/{id}/promote`
Promote a fleeting note to permanent.

### `POST /api/notes/{fleetingId}/merge/{targetId}`
Merge a fleeting note into an existing permanent note.

### `GET /api/notes/{id}/related`
Find semantically related notes using pgvector cosine similarity.

### `GET /api/notes/{id}/backlinks`
Find notes that link to this note via `[[Title]]` wikilinks.

### `GET /api/notes/{id}/suggested-tags`
AI-suggested tags derived from embedding similarity.

### `GET /api/notes/{id}/versions`
List version history for a note.

### `GET /api/notes/{id}/versions/{versionId}`
Get a specific historical version.

### `POST /api/notes/re-embed`
Queue all notes for re-embedding (use after changing embedding model).

### `POST /api/notes/check-duplicate`
Check if similar content already exists.

### `GET /api/notes/discover`
Discover semantically unrelated notes for broadening the knowledge graph.

### `GET /api/notes/search-titles`
Autocomplete note titles (for wikilink suggestions).

---

## Tags

### `GET /api/tags?prefix=`
Search tags by prefix.

---

## Search

### `GET /api/search?q=&type=`
Search notes.

**Query params:**
- `q` — search query
- `type` — `hybrid` (default), `fulltext`, `semantic`

Hybrid mode: weighted combination of PostgreSQL full-text (`tsvector`) and pgvector cosine similarity.

---

## Graph

### `GET /api/graph?threshold=`
Build the knowledge graph.

**Query params:** `threshold` (semantic edge similarity floor, default 0.8)

**Response:**
```json
{
  "nodes": [{ "id": "string", "title": "string", "edgeCount": 0 }],
  "edges": [{ "source": "string", "target": "string", "type": "wikilink|semantic", "weight": 0.0 }]
}
```

---

## Capture

### `POST /api/capture/email`
Email webhook. Requires `X-Webhook-Secret` header.

### `POST /api/capture/telegram`
Telegram webhook. Requires `X-Telegram-Bot-Api-Secret-Token` header.

Rate limited: 10 requests/minute.

---

## Export / Import

### `GET /api/export`
Export all notes as a ZIP archive (markdown files with YAML front matter).

### `POST /api/import`
Bulk import markdown files.

---

## Content Generation

Endpoints for the automated content generator. Generates blog posts and social media drafts from the Zettelkasten knowledge graph.

### `POST /api/content/generate`
Trigger a manual content generation run. Selects a random seed note, traverses the graph, and generates a blog post plus social media posts via LLM.

**Response:** `201 Created` — `ContentGeneration` object
**Error:** `409 Conflict` — `{ "error": "No eligible notes available for content generation." }` when no unvisited permanent notes with embeddings remain.

---

### `GET /api/content/generations`
List all generation runs, newest first.

**Query params:** `skip` (default 0), `take` (1–200, default 50)

**Response:** `200 OK`
```json
{
  "items": [
    {
      "id": "string",
      "seedNoteId": "string",
      "clusterNoteIds": ["string"],
      "topicSummary": "string",
      "status": "Pending | Generated | Approved | Rejected",
      "generatedAt": "datetime",
      "reviewedAt": "datetime | null"
    }
  ],
  "totalCount": 0
}
```

---

### `GET /api/content/generations/{id}`
Get a generation run with all its content pieces.

**Response:** `200 OK` — generation object including `pieces[]` | `404 Not Found`

---

### `GET /api/content/pieces`
List content pieces with optional filtering, newest first.

**Query params:** `skip`, `take` (1–200, default 50), `medium` (`blog` | `social`), `status` (`Draft` | `Approved` | `Rejected`)

**Response:** `200 OK` — paged list of `ContentPiece` objects.

---

### `GET /api/content/pieces/{id}`
Get a single content piece.

**Response:** `200 OK` | `404 Not Found`

```json
{
  "id": "string",
  "generationId": "string",
  "medium": "blog | social",
  "title": "string | null",
  "body": "string (markdown)",
  "status": "Draft | Approved | Rejected",
  "sequence": 0,
  "createdAt": "datetime",
  "approvedAt": "datetime | null"
}
```

---

### `PUT /api/content/pieces/{id}/approve`
Approve a content piece. Sets `status = Approved` and records `approvedAt`.

**Response:** `204 No Content` | `404 Not Found`

---

### `PUT /api/content/pieces/{id}/reject`
Reject a content piece. Sets `status = Rejected`.

**Response:** `204 No Content` | `404 Not Found`

---

### `GET /api/content/pieces/{id}/export`
Download a content piece as a markdown file.

**Response:** `200 OK` — `text/markdown` file download
Filename: sanitized title + `.md`, or `content-{id}.md` if no title.
**Error:** `404 Not Found`

---

### `GET /api/content/schedule`
Get current generation schedule settings (read from configuration).

**Response:** `200 OK`
```json
{
  "enabled": false,
  "dayOfWeek": "Monday",
  "timeOfDay": "09:00"
}
```

---

### `PUT /api/content/schedule`
Echo back schedule settings. **Note:** This endpoint does not persist changes. To modify the schedule, update `ContentGeneration:Schedule:*` in `appsettings.json` or environment variables.

**Body:** `{ "enabled": bool, "dayOfWeek": "string", "timeOfDay": "string" }`

**Response:** `200 OK` — echoed settings.

---

## Voice Configuration

Manages user writing samples and style notes used to replicate the user's voice during content generation.

### `GET /api/voice/examples`
List all voice examples, newest first.

**Response:** `200 OK`
```json
[
  {
    "id": "string",
    "medium": "blog | social | all",
    "title": "string | null",
    "content": "string",
    "source": "string | null",
    "createdAt": "datetime"
  }
]
```

---

### `POST /api/voice/examples`
Add a new voice example.

**Body:**
```json
{
  "medium": "blog | social | all",
  "title": "string?",
  "content": "string (required)",
  "source": "string?"
}
```

**Response:** `201 Created` — voice example object | `400 Bad Request`

---

### `DELETE /api/voice/examples/{id}`
Delete a voice example.

**Response:** `204 No Content` | `404 Not Found`

---

### `GET /api/voice/config?medium=`
Get voice configuration. Optionally filter by medium.

**Query params:** `medium` (`blog` | `social` | `all`) — optional

**Response:** `200 OK` — array of config objects
```json
[
  {
    "id": "string",
    "medium": "blog | social | all",
    "styleNotes": "string | null",
    "updatedAt": "datetime"
  }
]
```

---

### `PUT /api/voice/config`
Create or update style notes for a medium (upsert).

**Body:**
```json
{
  "medium": "blog | social | all",
  "styleNotes": "string?"
}
```

**Response:** `200 OK` — updated config object | `400 Bad Request`

---

## KB Health

### `GET /api/kb-health/overview`
Full knowledge base health overview: scorecard metrics, recent orphans, richest clusters, and notes never used as generation seeds.

**Response:** `200 OK`
```json
{
  "scorecard": {
    "totalNotes": 342,
    "embeddedPercent": 87,
    "orphanCount": 23,
    "averageConnections": 4.2
  },
  "newAndUnconnected": [
    {
      "id": "string",
      "title": "string",
      "createdAt": "datetime",
      "suggestionCount": 5
    }
  ],
  "richestClusters": [
    {
      "hubNoteId": "string",
      "hubTitle": "string",
      "noteCount": 42
    }
  ],
  "neverUsedAsSeeds": [
    {
      "id": "string",
      "title": "string",
      "connectionCount": 12
    }
  ]
}
```

Notes:
- `newAndUnconnected` — permanent notes added in the last 30 days with zero connections, newest first.
- `richestClusters` — top 5 connected components by note count (minimum 2 notes). Hub is the most-connected note in the component.
- `neverUsedAsSeeds` — permanent notes with `EmbedStatus=Completed` not in `UsedSeedNotes`, sorted by connection count descending.

---

### `GET /api/kb-health/orphan/{id}/suggestions`
Top semantically similar notes for a given orphan note. Powered by pgvector cosine similarity at threshold 0.6.

**Query params:** `limit` (default 5)

**Response:** `200 OK`
```json
[
  {
    "noteId": "string",
    "title": "string",
    "similarity": 0.87
  }
]
```

Returns empty array if the note has no embedding or no similar notes above the threshold.

---

### `POST /api/kb-health/orphan/{id}/link`
Insert a `[[TargetTitle]]` wikilink at the end of an orphan note's content. Sets the orphan note's `EmbedStatus` to `Stale` for re-processing.

**Body:**
```json
{ "targetNoteId": "string" }
```

**Response:** `200 OK` — updated orphan note | `404 Not Found` — if orphan or target note not found

---

## Research

Autonomous research agent that analyses KB health, generates search queries, and produces findings for human review.

### `POST /api/research/trigger`
Trigger a research run. Analyses the KB, generates a research agenda with search queries.

**Body:**
```json
{ "sourceNoteId": "string | null" }
```

**Response:** `201 Created` — `ResearchAgenda` object with tasks.

---

### `POST /api/research/agenda/{agendaId}/approve`
Approve a research agenda and start async execution. Returns immediately (fire-and-forget).

**Body:**
```json
{ "blockedTaskIds": ["string"] }
```

**Response:** `202 Accepted`

---

### `GET /api/research/findings`
Get all pending research findings awaiting review.

**Response:** `200 OK`
```json
[
  {
    "id": "string",
    "taskId": "string",
    "title": "string",
    "synthesis": "string",
    "sourceUrl": "string",
    "sourceType": "WebSearch | Arxiv",
    "status": "Pending | Accepted | Dismissed",
    "createdAt": "datetime",
    "reviewedAt": "datetime | null"
  }
]
```

---

### `POST /api/research/findings/{findingId}/accept`
Accept a finding — creates a fleeting note from the synthesis.

**Response:** `201 Created` — Note object | `404 Not Found`

---

### `POST /api/research/findings/{findingId}/dismiss`
Dismiss a finding.

**Response:** `204 No Content`

---

## Text-to-Speech / Speech-to-Text

All audio endpoints route through **Cloudflare AI Gateway** with a 3-tier fallback:
1. Stored API key (ElevenLabs) via gateway
2. Unified billing via AI Gateway
3. Workers AI (Deepgram Aura 2 for TTS, Whisper for STT)

### `POST /api/tts`
Convert text to speech. Returns raw audio bytes.

**Body:**
```json
{
  "text": "string (required)",
  "voice": "string (optional, default: alloy)",
  "model": "string (optional)",
  "speed": 1.0,
  "language": "string (optional)"
}
```

**Response:** `200 OK` -- `audio/mpeg` binary

---

### `POST /api/stt`
Transcribe audio to text. Accepts raw audio binary (`Content-Type: application/octet-stream`) or JSON with base64-encoded audio.

**JSON body (alternative):**
```json
{
  "audio": "base64-encoded audio data",
  "language": "string (optional)"
}
```

**Response:** `200 OK`
```json
{
  "text": "transcribed text",
  "language": "en",
  "segments": [
    { "start": 0.0, "end": 2.5, "text": "Hello world" }
  ]
}
```

---

### `GET /api/tts/voices`
List available voices.

**Response:** `200 OK`
```json
[
  { "voice_id": "alloy", "name": "Alloy", "category": "universal" }
]
```

---

## KB Health (Extended)

### `GET /api/kb-health/missing-embeddings`
List notes with `EmbedStatus` of Pending, Failed, or Stale.

**Response:** `200 OK` -- array of `{ id, title, embedStatus, embedError }`

---

### `POST /api/kb-health/missing-embeddings/{noteId}/requeue`
Reset a single note's embed status and send it to the embedding queue.

**Response:** `200 OK` -- `{ queued: true }`

---

### `POST /api/kb-health/missing-embeddings/requeue-all`
Bulk requeue all Pending/Stale/Failed notes for embedding.

**Response:** `200 OK`
```json
{ "total": 46, "queued": 46 }
```

---

### `GET /api/kb-health/large-notes`
List notes exceeding a character count threshold.

**Query params:** `threshold` (default 2000)

**Response:** `200 OK` -- array of `{ id, title, characterCount }`

---

### `POST /api/kb-health/large-notes/{noteId}/summarize`
AI-powered summarisation of a large note. Replaces the note content with a concise version.

**Response:** `200 OK`
```json
{ "noteId": "string", "originalLength": 5000, "summarizedLength": 800, "stillLarge": false }
```

---

### `POST /api/kb-health/large-notes/{noteId}/split-suggestions`
AI analysis of how a large note could be split into atomic notes.

**Response:** `200 OK`
```json
{
  "noteId": "string",
  "originalTitle": "string",
  "notes": [
    { "title": "Atomic Note 1", "content": "..." },
    { "title": "Atomic Note 2", "content": "..." }
  ]
}
```

---

### `POST /api/kb-health/large-notes/{noteId}/apply-split`
Create new notes from split suggestions.

**Body:**
```json
{ "notes": [{ "title": "string", "content": "string" }] }
```

**Response:** `200 OK` -- `{ createdNoteIds: ["string"] }`

---

## Settings

### `GET /api/settings`
Get current LLM provider and model.

**Response:** `200 OK` -- `{ provider: "openrouter", model: "openai/gpt-4o" }`

### `PUT /api/settings/model`
Update LLM provider and model.

**Body:** `{ "provider": "openrouter | google | workersai", "model": "string" }`

**Response:** `200 OK`

---

## Streaming

### `POST /api/generate/stream`
SSE streaming chat completion.

**Body:**
```json
{
  "messages": [{ "role": "system | user | assistant", "content": "string" }],
  "maxTokens": 2000,
  "temperature": 0.7
}
```

**Response:** `200 OK` -- `text/event-stream`

---

## Publish

### `POST /api/publish`
Publish a content piece to one or more channels (blog, linkedin, youtube, resend).

**Body:**
```json
{
  "pieceId": "string (required)",
  "channels": ["blog", "linkedin", "youtube", "resend"],
  "domain": "thinkingfeeling.com (optional, for blog)",
  "slug": "custom-url-slug (optional, for blog)",
  "emailTo": "recipient@example.com (for resend)",
  "emailFrom": "sender@example.com (for resend)",
  "emailSubject": "string (for resend)",
  "videoUrl": "string (for youtube)",
  "videoDescription": "string (for youtube)"
}
```

**Response:** `200 OK` (all succeeded) or `207 Multi-Status` (partial success)
```json
{
  "success": true,
  "results": [
    { "channel": "blog", "success": true, "externalUrl": "https://thinkingfeeling.com/my-post", "externalId": "..." },
    { "channel": "linkedin", "success": true, "externalUrl": "..." }
  ]
}
```

### `GET /api/publish/history/:pieceId`
Get publish history for a content piece.

**Response:** `200 OK`
```json
{
  "history": [
    { "id": "...", "pieceId": "...", "channel": "blog", "status": "success", "externalUrl": "...", "publishedAt": "..." }
  ]
}
```

### `GET /api/publish/blog-posts`
List published blog posts. Query params: `domain`, `skip`, `take`.

**Response:** `200 OK`
```json
{ "items": [...], "totalCount": 5 }
```

### `DELETE /api/publish/blog-posts/:id`
Archive (unpublish) a blog post.

**Response:** `200 OK`

### `GET /api/publish/blog-domains`
Get configured blog domains.

**Response:** `200 OK`
```json
{ "domains": ["thinkingfeeling.com"] }
```

### `PUT /api/publish/blog-domains`
Update configured blog domains.

**Body:**
```json
{ "domains": ["thinkingfeeling.com", "another-domain.com"] }
```

**Response:** `200 OK`

---

## Blog (Public)

Blog posts are served as HTML when requests arrive at a configured blog domain. No authentication required.

| Route | Description |
|---|---|
| `GET /` | Blog home — latest posts |
| `GET /archive` | Full archive |
| `GET /rss.xml` | RSS feed |
| `GET /:slug` | Individual blog post |
