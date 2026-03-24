# Zettl Roadmap

## Completed (MVP)

- [x] D1 + Vectorize migration (from Neon PostgreSQL + pgvector)
- [x] FTS5 full-text search with auto-sync triggers
- [x] AI Gateway standardization (OpenRouter + Google AI Studio)
- [x] Central LLM service (`services/llm.ts`) with streaming support
- [x] Settings API (provider/model selection persisted in D1)
- [x] SSE streaming generate endpoint (`/api/generate/stream`)
- [x] BlockNote editor (replaced TipTap)
- [x] Autosave for existing notes (debounced 1200ms)
- [x] Read-only BlockNote rendering with legacy HTML fallback
- [x] ASP.NET backend removal

## Deferred

### Real-time Collaboration
- Durable Objects for per-note collaboration sessions
- Yjs CRDT integration with BlockNote's built-in Yjs support
- Cursor presence and awareness

### Workers Streams
- Replace current SSE implementation with Workers Streams API
- Bidirectional streaming for interactive AI workflows

### Scheduled Content
- Cron-triggered content generation improvements
- Topic clustering with Vectorize for smarter seed selection
- Multi-step editorial workflows with approval queues

### Editor Enhancements
- Wiki-link autocomplete in BlockNote (slash menu or custom inline content)
- AI inline actions (summarize selection, expand, rewrite) via `/api/generate/stream`
- Image/file upload to R2 with BlockNote file blocks
- Collaborative editing via Durable Objects + Yjs

### Search & Discovery
- Hybrid search ranking improvements (BM25 + vector fusion)
- Saved searches and search history
- Graph-based note recommendations

### Infrastructure
- Secrets Store migration for all API keys (currently env vars + Secrets Store)
- Hyperdrive connection pooling (if external DB needed in future)
- Analytics via Workers Analytics Engine
- Rate limiting via Cloudflare Rate Limiting rules
