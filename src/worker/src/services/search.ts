import type { NeonQueryFunction } from '@neondatabase/serverless'
import type { SearchResult, SearchWeights } from '../types'
import { generateEmbedding, toVectorLiteral } from './embeddings'
import type OpenAI from 'openai'

export async function fullTextSearch(
  sql: NeonQueryFunction<false, false>,
  query: string,
  limit = 50,
): Promise<SearchResult[]> {
  const rows = await sql`
    SELECT "Id" AS "noteId",
           "Title" AS "title",
           ts_headline('english', "Content",
                       plainto_tsquery('english', ${query}),
                       'MaxWords=35,MinWords=15,StartSel=,StopSel=') AS "snippet",
           ts_rank(to_tsvector('english', "Title" || ' ' || "Content"),
                   plainto_tsquery('english', ${query}))::float8 AS "rank"
    FROM "Notes"
    WHERE to_tsvector('english', "Title" || ' ' || "Content")
          @@ plainto_tsquery('english', ${query})
    ORDER BY "rank" DESC
    LIMIT ${limit}
  ` as SearchResult[]
  return rows
}

export async function semanticSearch(
  sql: NeonQueryFunction<false, false>,
  openai: OpenAI,
  query: string,
  weights: SearchWeights,
  limit = 20,
): Promise<SearchResult[]> {
  const embedding = await generateEmbedding(openai, query)
  const vec = toVectorLiteral(embedding)
  const rows = await sql`
    SELECT "Id" AS "noteId",
           "Title" AS "title",
           CASE WHEN LENGTH("Content") > 200
                THEN LEFT("Content", 200) || '...'
                ELSE "Content"
           END AS "snippet",
           (1.0 - ("Embedding"::vector <=> ${vec}::vector))::float8 AS "rank"
    FROM "Notes"
    WHERE "Embedding" IS NOT NULL
      AND 1.0 - ("Embedding"::vector <=> ${vec}::vector) >= ${weights.minimumSimilarity}
    ORDER BY "Embedding"::vector <=> ${vec}::vector
    LIMIT ${limit}
  ` as SearchResult[]
  return rows
}

export async function hybridSearch(
  sql: NeonQueryFunction<false, false>,
  openai: OpenAI,
  query: string,
  weights: SearchWeights,
): Promise<SearchResult[]> {
  const [ftResults, semResults] = await Promise.all([
    fullTextSearch(sql, query),
    semanticSearch(sql, openai, query, weights).catch(() => [] as SearchResult[]),
  ])

  // Normalize full-text ranks to [0, 1]
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

export async function findRelated(
  sql: NeonQueryFunction<false, false>,
  noteId: string,
  minimumSimilarity: number,
  limit = 5,
): Promise<SearchResult[]> {
  const [note] = await sql`
    SELECT "Embedding" FROM "Notes" WHERE "Id" = ${noteId} AND "Embedding" IS NOT NULL
  ` as { Embedding: number[] | null }[]

  if (!note?.Embedding) return []

  const vec = toVectorLiteral(note.Embedding)
  const results = await sql`
    SELECT "Id" AS "noteId",
           "Title" AS "title",
           CASE WHEN LENGTH("Content") > 200
                THEN LEFT("Content", 200) || '...'
                ELSE "Content"
           END AS "snippet",
           (1.0 - ("Embedding"::vector <=> ${vec}::vector))::float8 AS "rank"
    FROM "Notes"
    WHERE "Embedding" IS NOT NULL
      AND "Id" != ${noteId}
      AND 1.0 - ("Embedding"::vector <=> ${vec}::vector) >= ${minimumSimilarity}
    ORDER BY "Embedding"::vector <=> ${vec}::vector
    LIMIT ${limit}
  `
  return results as unknown as SearchResult[]
}

function normalizeRanks(results: SearchResult[]): SearchResult[] {
  if (!results.length) return []
  const max = Math.max(...results.map(r => r.rank))
  const min = Math.min(...results.map(r => r.rank))
  const range = max - min
  return results.map(r => ({ ...r, rank: range === 0 ? 1 : (r.rank - min) / range }))
}
