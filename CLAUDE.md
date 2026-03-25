# CLAUDE.md — Zettel System

Project-level instructions that override or extend global defaults.

---

## Stack

- **Backend**: Cloudflare Workers (Hono), D1 (SQLite), Vectorize, R2, Queues
- **Frontend**: React, TypeScript, Vite, TanStack Query, Tailwind v4, shadcn/ui, BlockNote
- **AI**: All AI calls route through **Cloudflare AI Gateway "x"** with unified billing — no direct model calls
- **Docs**: `docs/` — see `docs/compound/index.md` for searchable learnings

---

## AI Gateway — CRITICAL

**Every AI call MUST go through AI Gateway.** Never call models directly (no `ai_binding.run()`, no direct ElevenLabs/OpenRouter/etc API calls).

- **Gateway ID**: `x`
- **Account ID**: `85d376fc54617bcb57185547f08e528b`
- **Auth**: `cf-aig-authorization: Bearer <CF_AIG_TOKEN>` header (unified billing)
- **Base URL**: `https://gateway.ai.cloudflare.com/v1/{ACCOUNT_ID}/{GATEWAY_ID}`

### Dynamic Routes

| Route | Endpoint pattern | Purpose |
|---|---|---|
| `text_gen` | `/compat/chat/completions` with `model: "dynamic/text_gen"` | LLM chat/content generation |
| `research_gen` | `/compat/chat/completions` with `model: "dynamic/research_gen"` | Perplexity research |
| `audio_gen` | `/compat/audio/speech` with `model: "dynamic/audio_gen"` | Text-to-speech |
| `stt_gen` | `/compat/audio/transcriptions` | Speech-to-text |
| `ai_embed` | `/compat/embeddings` with `model: "dynamic/ai_embed"` | Text embeddings (2056-dim, pplx-embed-context-v1-4b) |

### Key files

- `src/worker/src/services/llm.ts` — `gatewayChat()` for text_gen / research_gen
- `src/worker/src/services/embeddings.ts` — `generateEmbeddingAI()` for ai_embed
- `src/worker/src/services/audio.ts` — `textToSpeech()` / `speechToText()` for audio_gen / stt_gen

---

## Full-Stack Feature Completion Checklist

**Every new API endpoint must include all three layers in the same commit.**

When adding any controller action:

- [ ] Backend endpoint implemented and tests passing
- [ ] API client function added to `src/zettel-web-ui/src/api/*.ts`
  - [ ] HTTP verb matches the route method exactly
  - [ ] URL path matches the route exactly
- [ ] UI wired up: button/trigger, loading state, success toast, error toast
- [ ] React Query cache invalidated correctly (right query key)
- [ ] `docs/API_REFERENCE.md` updated

---

## Compound Docs

Before solving a problem, check `docs/compound/index.md` — it may already be documented.
After solving a non-trivial problem, run `/workflows:evolve` to capture the learning.

<!-- claude-reliability:binary-instructions managed section - DO NOT EDIT -->
## claude-reliability Binary

The `claude-reliability` binary for this project is located at:

    .claude-reliability/bin/claude-reliability

Always use this path when running commands. Do NOT use bare `claude-reliability`,
do NOT use paths containing `~/.claude-reliability/`, and do NOT use `$PLUGIN_ROOT_DIR`
or any other variable to construct the path.

Example usage:

    .claude-reliability/bin/claude-reliability work list
    .claude-reliability/bin/claude-reliability work next
    .claude-reliability/bin/claude-reliability work on <id>
    .claude-reliability/bin/claude-reliability work update <id> --status complete
<!-- end claude-reliability:binary-instructions -->
