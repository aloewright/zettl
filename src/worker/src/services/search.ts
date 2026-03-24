import type { Db } from '../db/client'
import type { Env, SearchResult, SearchWeights } from '../types'
import { generateEmbeddingAI } from './embeddings'

/**
 * Full-text search using FTS5.
 */
export async function fullTextSearch(
  db: Db,
  query: string,
  limit = 50,
): Promise<SearchResult[]> {
  // FTS5 query — escape double quotes in user input
  const ftsQuery = query.replace(/"/g, '""')
  const stmt = db.$client
    .prepare(`
      SELECT f."Id" AS noteId,
             f."Title" AS title,
             snippet(notes_fts, 2, '', '', '...', 35) AS snippet,
             rank AS rank
      FROM notes_fts f
      WHERE notes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `)
    .bind(ftsQuery, limit)

  const { results } = await stmt.all<SearchResult>()
  // FTS5 rank is negative (lower = better). Normalize to positive.
  const maxRank = Math.max(...(results ?? []).map(r => Math.abs(r.rank)), 1)
  return (results ?? []).map(r => ({ ...r, rank: Math.abs(r.rank) / maxRank }))
}

/**
 * Semantic search using Cloudflare Vectorize.
 */
export async function semanticSearch(
  vectorize: VectorizeIndex,
  db: Db,
  env: Env,
  query: string,
  weights: SearchWeights,
  limit = 20,
): Promise<SearchResult[]> {
  const embedding = await generateEmbeddingAI(env, query)

  const vecResults = await vectorize.query(embedding, {
    topK: limit,
    returnMetadata: 'all',
  })

  const matches = vecResults.matches.filter(m => (m.score ?? 0) >= weights.minimumSimilarity)
  if (!matches.length) return []

  // Fetch titles and snippets from D1
  const ids = matches.map(m => m.id)
  const placeholders = ids.map(() => '?').join(',')
  const { results } = await db.$client
    .prepare(`
      SELECT "Id" AS id, "Title" AS title,
             CASE WHEN LENGTH("Content") > 200
                  THEN SUBSTR("Content", 1, 200) || '...'
                  ELSE "Content"
             END AS snippet
      FROM "Notes"
      WHERE "Id" IN (${placeholders})
    `)
    .bind(...ids)
    .all<{ id: string; title: string; snippet: string }>()

  const noteMap = new Map((results ?? []).map(r => [r.id, r]))

  return matches
    .map(m => {
      const note = noteMap.get(m.id)
      if (!note) return null
      return {
        noteId: m.id,
        title: note.title,
        snippet: note.snippet,
        rank: m.score ?? 0,
      }
    })
    .filter((r): r is SearchResult => r !== null)
}

/**
 * Hybrid search combining FTS5 + Vectorize results.
 */
export async function hybridSearch(
  vectorize: VectorizeIndex,
  db: Db,
  env: Env,
  query: string,
  weights: SearchWeights,
): Promise<SearchResult[]> {
  const [ftResults, semResults] = await Promise.all([
    fullTextSearch(db, query),
    semanticSearch(vectorize, db, env, query, weights).catch(() => [] as SearchResult[]),
  ])

  const normalized = normalizeRanks(ftResults)
  const merged = new Map<string, { result: SearchResult; score: number }>()

  for (const r of normalized) {
    merged.set(r.noteId, { result: r, score: weights.fullTextWeight * r.rank })
  }
  for (const r of semResults) {
    const existing = merged.get(r.noteId)
    if (existing) {
      merged.set(r.noteId, { result: existing.result, score: existing.score + weights.semanticWeight * r.rank })
    } else {
      merged.set(r.noteId, { result: r, score: weights.semanticWeight * r.rank })
    }
  }

  const maxScore = Math.max(...[...merged.values()].map(v => v.score), 1)

  return [...merged.values()]
    .filter(v => v.score >= weights.minimumHybridScore)
    .map(v => ({ ...v.result, rank: Math.min(v.score / maxScore, 1) }))
    .sort((a, b) => b.rank - a.rank)
}

/**
 * Find notes related to a given note using Vectorize.
 */
export async function findRelated(
  vectorize: VectorizeIndex,
  db: Db,
  noteId: string,
  minimumSimilarity: number,
  limit = 5,
): Promise<SearchResult[]> {
  // Get the vector for this note from Vectorize
  const vectors = await vectorize.getByIds([noteId])
  if (!vectors.length || !vectors[0]?.values) return []

  const vecResults = await vectorize.query(vectors[0].values, {
    topK: limit + 1, // +1 to exclude self
    returnMetadata: 'all',
  })

  const matches = vecResults.matches
    .filter(m => m.id !== noteId && (m.score ?? 0) >= minimumSimilarity)
    .slice(0, limit)

  if (!matches.length) return []

  const ids = matches.map(m => m.id)
  const placeholders = ids.map(() => '?').join(',')
  const { results } = await db.$client
    .prepare(`
      SELECT "Id" AS id, "Title" AS title,
             CASE WHEN LENGTH("Content") > 200
                  THEN SUBSTR("Content", 1, 200) || '...'
                  ELSE "Content"
             END AS snippet
      FROM "Notes"
      WHERE "Id" IN (${placeholders})
    `)
    .bind(...ids)
    .all<{ id: string; title: string; snippet: string }>()

  const noteMap = new Map((results ?? []).map(r => [r.id, r]))

  return matches
    .map(m => {
      const note = noteMap.get(m.id)
      if (!note) return null
      return {
        noteId: m.id,
        title: note.title,
        snippet: note.snippet,
        rank: m.score ?? 0,
      }
    })
    .filter((r): r is SearchResult => r !== null)
}

function normalizeRanks(results: SearchResult[]): SearchResult[] {
  if (!results.length) return []
  const max = Math.max(...results.map(r => r.rank))
  const min = Math.min(...results.map(r => r.rank))
  const range = max - min
  return results.map(r => ({ ...r, rank: range === 0 ? 1 : (r.rank - min) / range }))
}
