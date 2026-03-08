# Code Review: Voice Interface

Generated: 2026-03-07
Agents: 7 (parallel execution) — architecture-reviewer, coupling-analyzer, failure-mode-analyst,
evolvability-assessor, react-frontend-reviewer, otel-tracing-reviewer, modularity-reviewer
Raw findings: 35 | After deduplication: 24

**Recommendation: Approve with changes — 4 critical issues must be fixed before production use**

---

## Agents & Compound Docs Consulted

| Agent | Findings | Key Concern |
|---|---|---|
| architecture-reviewer | 10 | Sync httpx, no HEALTHCHECK, route redirect |
| coupling-analyzer | 6 | Strands v0.x coupling, unversioned protocol schema |
| failure-mode-analyst | 9 | RPN 504 event-loop block, RPN 336 gather supervision |
| evolvability-assessor | 8 | Hardcoded constants, no tests, session ID missing |
| react-frontend-reviewer | 6 | Mic speaker playback, accessibility |
| otel-tracing-reviewer | 7 | No trace propagation, no OTel packages |
| modularity-reviewer | 5 | Hook decomposition, citation extraction placement |

---

## Critical Issues (Must Fix Before Production)

### 1. Sync `httpx.Client` blocks the asyncio event loop

**Agents**: architecture-reviewer, coupling-analyzer, failure-mode-analyst, evolvability-assessor
**FMEA RPN**: 504 (S=9 × O=7 × D=8)
**Files**: `voice-service/tools.py:24`, `voice-service/tools.py:36`

Both `search_notes` and `get_note` use `httpx.Client` (synchronous) inside an async FastAPI context.
FastAPI runs on a single asyncio event loop thread. When the sync client blocks, **every** concurrent
WebSocket session is frozen — no audio in, no audio out, no keepalives — for the duration of the
HTTP round-trip. With a 10 s timeout, this is a potential 10-second full-service stall.

This is not just a per-session performance issue; it is a global blast radius from a single tool call.

```python
# Current — blocks entire event loop
with httpx.Client(timeout=10.0) as client:
    response = client.get(url, params={"q": query, "type": "hybrid"})

# Fix — async client, non-blocking
async with httpx.AsyncClient(timeout=10.0) as client:
    response = await client.get(url, params={"q": query, "type": "hybrid"})
```

Both tool functions must become `async def`. Verify that the Strands `@tool` decorator supports
async tools (it does as of the version used). Also promote `httpx.AsyncClient` to a module-level
shared instance to enable connection pooling and OTel instrumentation.

---

### 2. Microphone audio plays back through speakers

**Agent**: react-frontend-reviewer
**File**: `src/zettel-web-ui/src/hooks/use-voice-session.ts:293`

```ts
processor.connect(audioCtx.destination)
```

`ScriptProcessorNode` requires a downstream graph connection to fire `onaudioprocess`, but connecting
to `audioCtx.destination` routes raw microphone audio to the speaker output in real time.
- With speakers: immediate acoustic feedback loop
- With headphones: audible mic monitoring in the user's ear

Fix: route through a muted `GainNode` instead:

```ts
// Replace: processor.connect(audioCtx.destination)
const silentSink = audioCtx.createGain()
silentSink.gain.value = 0
processor.connect(silentSink)
silentSink.connect(audioCtx.destination)
```

---

### 3. No Docker health check — voice service starts before backend is ready

**Agents**: architecture-reviewer, failure-mode-analyst
**FMEA RPN**: 210 (S=6 × O=7 × D=5)
**Files**: `voice-service/Dockerfile` (no HEALTHCHECK), `docker-compose.yml:75`

The `Dockerfile` has no `HEALTHCHECK` instruction. The `docker-compose.yml` has:

```yaml
depends_on:
  - backend          # waits for container to START, not to be healthy
```

The backend runs EF Core migrations (`db.Database.Migrate()`) at startup which can take several
seconds. During this window the voice service accepts WebSocket connections, fires tool calls, and
they all fail with connection-refused or 503.

Fix (two changes):

```dockerfile
# voice-service/Dockerfile — add before CMD
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
```

```yaml
# docker-compose.yml — voice-service depends_on
depends_on:
  backend:
    condition: service_healthy
```

This also requires adding a `healthcheck` block to the `backend` service entry in `docker-compose.yml`
(the `.NET API`'s `/health` endpoint already exists at `PathPrefix(/health)`).

---

### 4. No distributed trace context propagation to .NET API

**Agent**: otel-tracing-reviewer
**File**: `voice-service/tools.py:24`, `voice-service/tools.py:36`

The `httpx` calls carry no W3C `traceparent` header. Every call to `GET /api/search` and
`GET /api/notes/{id}` arrives at ASP.NET Core as a new root trace. The existing `search.hybrid`,
`search.semantic`, and `search.fulltext` spans in `SearchService.cs` have no parent and no
connection to the voice session that triggered them. The two services are completely invisible
to each other in any tracing backend.

```python
# requirements.txt — add:
opentelemetry-sdk>=1.25.0
opentelemetry-exporter-otlp-proto-grpc>=1.25.0
opentelemetry-instrumentation-httpx>=0.46b0

# tools.py — inject at call site (or use HTTPXClientInstrumentor at startup):
from opentelemetry import propagate

def _trace_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    propagate.inject(headers)
    return headers

# In each tool call:
response = await client.get(url, params=..., headers=_trace_headers())
```

The .NET `AddAspNetCoreInstrumentation()` middleware extracts the `traceparent` header automatically.

---

## Important Issues (Should Fix)

### 5. `asyncio.gather` — one arm raising leaves session half-alive

**Agent**: failure-mode-analyst
**FMEA RPN**: 336 (S=8 × O=6 × D=7)
**File**: `voice-service/main.py:132`

`asyncio.gather(_receive_from_browser(), _receive_from_agent())` — if either coroutine raises
an unexpected exception, `gather` (with default `return_exceptions=False`) cancels the other via
`CancelledError`. A `CancelledError` raised inside `async for event in agent.receive()` may not
cleanly close the upstream Bedrock stream, potentially leaving an orphaned session consuming
AWS quota. Use a `TaskGroup` (Python 3.11+) or `return_exceptions=True` with explicit inspection:

```python
# Python 3.11+ TaskGroup — cancels group on first exception, re-raises cleanly
async with asyncio.TaskGroup() as tg:
    tg.create_task(_receive_from_browser())
    tg.create_task(_receive_from_agent())
```

---

### 6. `BidiErrorEvent` continues session in undefined state

**Agents**: architecture-reviewer, failure-mode-analyst
**File**: `voice-service/main.py:127-130`

After a `BidiErrorEvent`, the error is forwarded to the browser (which correctly transitions to
`state === 'error'`) but the server-side `_receive_from_agent` loop continues iterating. If the
SDK yields a `BidiResponseCompleteEvent` after the error, the server sends a `{"type":"status","state":"listening"}`
event, contradicting the browser's `error` state.

Fix: after handling `BidiErrorEvent`, stop the session:

```python
elif isinstance(event, BidiErrorEvent):
    message = getattr(event, "message", str(event))
    logger.error("BidiAgent error event: %s", message)
    await _send_json({"type": "error", "message": message})
    break  # exit _receive_from_agent; finally block calls agent.stop()
```

---

### 7. `connect()` missing guard for active states — double-connect race

**Agent**: failure-mode-analyst
**FMEA RPN**: 168 (S=7 × O=4 × D=6)
**File**: `src/zettel-web-ui/src/hooks/use-voice-session.ts:150-152`

`connect()` only guards on `unavailable` and `error` states. If called while `listening`,
`thinking`, or `speaking` (e.g., via a race condition or programmatic call), it runs `cleanup()`
tearing down the active session and immediately opens a second one, creating two concurrent
Bedrock sessions for the same user.

```ts
// Add at the top of connect(), before the health re-check:
if (state === 'listening' || state === 'thinking' || state === 'speaking') return
```

---

### 8. Strands SDK v0.x — 7 experimental symbols with no anti-corruption layer

**Agents**: coupling-analyzer, architecture-reviewer, evolvability-assessor
**File**: `voice-service/main.py:13-21`, `voice-service/agent.py:5-6`

`strands-agents[bidi]==1.29.0` is pre-1.0 with no stability guarantees. Seven symbols are imported
directly from `strands.experimental.bidi` in `main.py`. Any SDK minor bump can rename or remove
these symbols with no warning.

Define a thin local `VoiceSession` adapter in `voice-service/session.py` that wraps `BidiAgent`
and exposes only `start()`, `send(bytes)`, `receive() -> AsyncIterator[VoiceEvent]`, and `stop()`.
All `strands.experimental.bidi` imports migrate to that one file. When the SDK breaks, one file
to update.

---

### 9. JSON event schema is an unversioned, untested shared contract

**Agent**: coupling-analyzer
**Files**: `voice-service/main.py` (emitter), `use-voice-session.ts:246-273` (consumer)

The six event types (`status`, `citations`, `transcript`, `error`) are expressed as two independent
`switch` / `isinstance` blocks with no shared type definition and no version marker. Any divergence
is silent at both ends.

At minimum: define a TypeScript discriminated union for the event types and export it from
`src/api/voice.ts`. Add a Python `TypedDict` for each event shape in `main.py` or a new
`voice-service/events.py`. A version field in each message (`"v": 1`) enables graceful future evolution.

---

### 10. Model ID, voice name, and all agent tuning parameters are hardcoded

**Agents**: coupling-analyzer, evolvability-assessor
**File**: `voice-service/agent.py:18-43`

`"amazon.nova-sonic-v2:0"`, `"matthew"`, `"MEDIUM"`, `2048`, `0.7` are all hardcoded. AWS deprecates
model versions; voice quality preferences differ per deployment. All should be env vars with current
values as defaults:

```python
_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "amazon.nova-sonic-v2:0")
_VOICE_NAME = os.getenv("NOVA_SONIC_VOICE", "matthew")
_VAD_SENSITIVITY = os.getenv("NOVA_SONIC_VAD_SENSITIVITY", "MEDIUM")
_MAX_TOKENS = int(os.getenv("NOVA_SONIC_MAX_TOKENS", "2048"))
_TEMPERATURE = float(os.getenv("NOVA_SONIC_TEMPERATURE", "0.7"))
```

---

### 11. No `test-voice-service` CI job

**Agents**: coupling-analyzer, architecture-reviewer, evolvability-assessor
**File**: `.github/workflows/build-and-push.yml`

`test-backend` and `test-frontend` both gate the GHCR push. The voice service is built and pushed
but never tested. Dependency resolution failures and import errors are caught at image build time
(late), not at test time (early). `requirements.txt` has no test dependencies.

Add a `test-voice-service` job:
```yaml
test-voice-service:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-python@v5
      with: { python-version: "3.12" }
    - run: pip install -r requirements.txt
      working-directory: voice-service
    - run: python -m py_compile main.py agent.py tools.py
      working-directory: voice-service
```

Add to `needs: [test-backend, test-frontend, test-voice-service]` on the GHCR matrix job.

---

### 12. Tool exceptions not handled — undefined agent behaviour on .NET API errors

**Agents**: architecture-reviewer, otel-tracing-reviewer
**File**: `voice-service/tools.py:26`, `voice-service/tools.py:38`

`response.raise_for_status()` propagates `httpx.HTTPStatusError` unhandled up through the Strands
tool dispatch. How the `BidiAgent` surfaces a tool exception to Nova Sonic is SDK-dependent and
untested. Wrap in try/except and return a structured error payload so the agent always receives
a well-formed response:

```python
try:
    response.raise_for_status()
    return response.json()
except httpx.HTTPStatusError as exc:
    logger.error("zettel api error: %s %s", exc.response.status_code, str(exc.request.url))
    return {"error": "knowledgebase temporarily unavailable", "status": exc.response.status_code}
```

---

### 13. No session lifecycle logging — sessions are undiagnosable

**Agent**: otel-tracing-reviewer
**File**: `voice-service/main.py`

There is no log on session start. The only lifecycle signals are a generic "disconnected" log
with no session ID and an exception log with no duration. You cannot correlate tool call errors
to a session, measure session duration, or distinguish a clean disconnect from a Bedrock error.

```python
# At websocket_endpoint entry:
session_id = str(uuid.uuid4())
start = time.monotonic()
logger.info("voice session started", extra={"session.id": session_id})

# In finally, before agent.stop():
logger.info("voice session ended", extra={
    "session.id": session_id,
    "session.duration_ms": round((time.monotonic() - start) * 1000, 1),
    "session.disconnect_reason": disconnect_reason,   # set in each except branch
})
```

Also: `logging.basicConfig` is never called. Without it, `logger.info` calls are dropped by
uvicorn's default root logger configuration. Add `logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))` at the top of `main.py`.

---

### 14. Accessibility gaps in `voice.tsx`

**Agent**: react-frontend-reviewer
**File**: `src/zettel-web-ui/src/pages/voice.tsx:153,177,190,199`

| Location | Gap | Fix |
|---|---|---|
| Transcript container (line 190) | No `role` or live region | Add `role="log"` and `aria-live="polite"` |
| Status indicator wrapper (line 177) | Visual-only state for screen readers | Add `role="status"` + `aria-label={STATUS_LABELS[state]}` |
| Mic button (line 153) | No `aria-busy` during connecting | Add `aria-busy={state === 'connecting'}` |
| Stop button (line 199) | No explicit label | Add `aria-label="Stop voice session"` |

---

### 15. ADR-013 status is "Proposed" — update to "Accepted"

**Agent**: architecture-reviewer
**File**: `docs/adr/ADR-013-voice-interface-architecture.md:5`

The feature is implemented. Update `Status: Proposed` → `Status: Accepted`.

---

## Suggestions (Nice to Have)

### 16. `ScriptProcessorNode` — add browser support guard

**Agents**: react-frontend-reviewer, failure-mode-analyst
**File**: `src/zettel-web-ui/src/hooks/use-voice-session.ts:289`
**FMEA RPN**: 216 for silent failure if removed by browser

`createScriptProcessor` is deprecated in favour of `AudioWorklet`. It still works in all current
browsers but will be removed eventually. Currently there is no guard, so a browser that has removed
it will produce a silent failure with the session stuck in `listening` state.

Add a detection guard before use:
```ts
if (typeof audioCtx.createScriptProcessor !== 'function') {
  setState('error')
  setErrorMessage('Your browser does not support the required audio API. Try a recent Chrome or Firefox.')
  return
}
// TODO: migrate to AudioWorkletNode — ScriptProcessorNode is deprecated
```

---

### 17. Citation extraction belongs in `tools.py`, not `main.py`

**Agents**: modularity-reviewer, architecture-reviewer, evolvability-assessor
**File**: `voice-service/main.py:99-122`

`main.py` encodes knowledge about tool return shapes (`noteId` vs `id` key names). If a new tool
returns notes in a different shape, `main.py` silently stops emitting citations. Extract:

```python
# tools.py
def extract_citations(result) -> list[dict]:
    """Extract {id, title} pairs from a tool result (list or single dict)."""
    ...

# main.py — just calls extract_citations(event.result)
```

---

### 18. 16 kHz sample rate constant duplicated in 5 places

**Agents**: coupling-analyzer, evolvability-assessor
**Files**: `main.py:62`, `agent.py:29-30`, `use-voice-session.ts:267,287,154`

Define once in each service:
- Python: `AUDIO_SAMPLE_RATE = 16_000` in `voice-service/config.py`
- TypeScript: `const AUDIO_SAMPLE_RATE = 16_000` at top of `use-voice-session.ts`

If Nova Sonic v2 adds support for 24 kHz audio, this is currently a find-and-fix-five-places
change instead of a one-place change. The Python and TypeScript values can drift independently
with no compiler error.

---

### 19. Health check has no loading state — mic button appears prematurely

**Agent**: react-frontend-reviewer
**File**: `src/zettel-web-ui/src/hooks/use-voice-session.ts:50`, `voice.tsx:151`

The hook initialises to `idle`, so the mic button renders immediately while the health check is
in-flight. If the service is slow to respond, users can click the mic before health is confirmed,
triggering a duplicate `connect()` health check. Add a `'checking'` initial state or initialise
to a `null`/loading state until the first health check resolves.

---

### 20. `connect` useCallback dep on `state` — recreated on every status update

**Agent**: react-frontend-reviewer
**File**: `src/zettel-web-ui/src/hooks/use-voice-session.ts:374`

`connect` depends on `state` only for the `unavailable`/`error` guard. This causes the callback
to be recreated on every `listening → thinking → speaking` transition. Move the active-state guard
to use a ref (`useRef` wrapping state) to give `connect` a stable identity.

---

### 21. Extract `CitationsSidebar` to `src/components/voice/`

**Agent**: modularity-reviewer
**File**: `src/zettel-web-ui/src/pages/voice.tsx:90-112`

`CitationsSidebar` has routing logic (`Link to /notes/:id`) and will grow (sorting, filtering).
Extract to `src/components/voice/CitationsSidebar.tsx`. The `TranscriptBubble` is also a good
extraction candidate when a second consumer appears. `StatusIndicator` is tightly coupled to
the voice page state machine and should stay internal for now.

---

### 22. Inline `@keyframes voice-wave` should be in `index.css`

**Agent**: react-frontend-reviewer
**File**: `src/zettel-web-ui/src/pages/voice.tsx:51-56`

The codebase uses `tw-animate-css` in `index.css` for animations. An inline `<style>` block
inside `StatusIndicator` is injected on every render cycle. Move `@keyframes voice-wave` to
`index.css` and reference via a Tailwind `animate-*` utility.

---

### 23. Split `use-voice-session.ts` into focused sub-hooks

**Agents**: modularity-reviewer, evolvability-assessor
**File**: `src/zettel-web-ui/src/hooks/use-voice-session.ts` (370 lines)

The hook fuses four concerns with four independent reasons to change:

| Sub-hook | Responsibility |
|---|---|
| `useVoiceServiceHealth` | Health check, polling, `isAvailable` |
| `useAudioPlayback` | `AudioContext`, `playPcmFrame`, `nextPlayTimeRef` |
| `useAudioCapture` | Mic stream, `ScriptProcessorNode`, VAD, resampling |
| `useVoiceSession` (orchestrator) | WebSocket, state machine, composes the above |

The `cleanup()` megafunction (touching refs across all four concerns) is the clearest symptom.
Not urgent for v1, but `connect()` is already 130+ lines — this is the natural split point
before it grows further.

---

## Architecture Assessment

| Principle | Score | Notes |
|---|---|---|
| Evolvability | 4/5 | Microservice boundary is clean; adding tools is trivial; model swap is contained in `agent.py` |
| Encapsulation | 4/5 | Hook presents a stable interface; .NET API unchanged; minor leak of tool return shapes into `main.py` |
| Coupling | 3/5 | Strands v0.x with 7 experimental symbols; unversioned JSON schema; 16kHz in 5 places |
| Understanding | 4/5 | Design doc + ADR are exemplary; code has section comments; `@keyframes` and `getattr` defensive access need comments |
| Failure Modes | 3/5 | Several high-RPN modes unaddressed: event-loop block, gather supervision, speaker echo, ScriptProcessorNode guard |

---

## Prioritised Fix Order

| # | Finding | Effort | Impact |
|---|---|---|---|
| 1 | Sync httpx → async (Finding 1) | S | Global session freeze prevention |
| 2 | Mic speaker echo fix (Finding 2) | XS | Immediate UX regression |
| 3 | BidiErrorEvent → break session (Finding 6) | XS | State machine correctness |
| 4 | connect() active-state guard (Finding 7) | XS | Race condition |
| 5 | ScriptProcessorNode browser guard (Finding 16) | XS | Silent failure detection |
| 6 | Docker HEALTHCHECK (Finding 3) | S | Startup correctness |
| 7 | OTel trace propagation (Finding 4) | M | Observability |
| 8 | Session logging + basicConfig (Finding 13) | S | Diagnosability |
| 9 | Tool exception handling (Finding 12) | S | Agent resilience |
| 10 | asyncio.gather → TaskGroup (Finding 5) | S | Resource leak prevention |
| 11 | agent.stop() log exception (Finding 5 adjacent) | XS | Silent failure |
| 12 | Test CI job (Finding 11) | S | Safety net for all future changes |
| 13 | ADR status (Finding 15) | XS | Documentation hygiene |

---

## Open Questions

- **Auth on the WebSocket**: The voice service currently accepts any WebSocket connection reaching
  the Traefik `/voice-service` path. Every session starts a Nova Sonic Bedrock session at AWS cost.
  Is this acceptable for a personal deployment, or should the browser's session token be validated
  before accepting the upgrade?

- **`/voice` → `/voice-config` redirect**: Was `/voice` previously accessible to users (bookmarked,
  linked externally)? If so, a `<Navigate to="/voice-config" replace />` redirect route should be
  added. If `/voice-config` is entirely new, no action needed.

- **Multi-turn memory design**: The evolvability agent flagged this as Medium-to-Hard (the design doc
  says Medium). The prerequisite is a session ID exchanged in the WS handshake. Is this in scope
  for the next iteration?

---

## Next Steps

Run `/triage` to process these 24 findings one by one.
Immediate fixes (1–5 in the priority table above) are all XS–S and can be done in a single session.
