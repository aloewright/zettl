"""Strands tools for querying the Zettel knowledgebase API."""

import logging
import os

import httpx
from opentelemetry import propagate
from strands import tool

logger = logging.getLogger(__name__)

AUDIO_SAMPLE_RATE = 16_000   # Hz — browser capture rate; must match frontend TARGET_RATE
AUDIO_OUTPUT_RATE = 24_000   # Hz — Nova Sonic native output rate; frontend playback must match

_MAX_CONTENT_CHARS = 4_000
_http_client = httpx.AsyncClient(timeout=10.0)


def _api_url() -> str:
    return os.getenv("ZETTEL_API_URL", "http://localhost:5000")


def _trace_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    propagate.inject(headers)
    return headers


@tool
async def search_notes(query: str) -> list[dict]:
    """Search the knowledgebase for notes relevant to a query.

    Returns a list of {noteId, title, snippet, rank} objects.
    Always call this first to discover relevant notes, then call get_note to
    read full content.
    """
    url = f"{_api_url()}/api/search"
    try:
        response = await _http_client.get(
            url, params={"q": query, "type": "hybrid"}, headers=_trace_headers()
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as exc:
        logger.error(
            "zettel api error",
            extra={
                "http.url": str(exc.request.url),
                "http.status_code": exc.response.status_code,
                "tool.name": "search_notes",
            },
        )
        return {"error": "knowledgebase temporarily unavailable", "status_code": exc.response.status_code}
    except httpx.RequestError as exc:
        logger.error("zettel api connection error: %s", exc)
        return {"error": "knowledgebase unreachable"}


@tool
async def get_note(note_id: str) -> dict:
    """Retrieve the full content of a specific note by its ID.

    Truncates content to 4000 characters to stay within context limits.
    """
    url = f"{_api_url()}/api/notes/{note_id}"
    try:
        response = await _http_client.get(url, headers=_trace_headers())
        response.raise_for_status()
        note = response.json()
    except httpx.HTTPStatusError as exc:
        logger.error(
            "zettel api error",
            extra={
                "http.url": str(exc.request.url),
                "http.status_code": exc.response.status_code,
                "tool.name": "get_note",
            },
        )
        return {"error": "knowledgebase temporarily unavailable", "status_code": exc.response.status_code}
    except httpx.RequestError as exc:
        logger.error("zettel api connection error: %s", exc)
        return {"error": "knowledgebase unreachable"}

    content = note.get("content", "")
    if len(content) > _MAX_CONTENT_CHARS:
        note["content"] = content[:_MAX_CONTENT_CHARS]

    return note


def extract_citations(result: list | dict) -> list[dict]:
    """Extract {id, title} citation pairs from a tool result.

    search_notes returns a list of {noteId, title, ...}.
    get_note returns a single dict with {id, title, ...}.
    """
    citations = []
    items = result if isinstance(result, list) else [result]
    for item in items:
        if not isinstance(item, dict):
            continue
        note_id = item.get("noteId") or item.get("id")
        title = item.get("title")
        if note_id and title:
            citations.append({"id": note_id, "title": title})
    return citations
