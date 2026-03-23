import { pgTable, varchar, text, integer, timestamp, doublePrecision } from 'drizzle-orm/pg-core'

// ── Notes ─────────────────────────────────────────────────────────────────────

export const notes = pgTable('Notes', {
  id: varchar('Id', { length: 21 }).primaryKey(),
  title: text('Title').notNull(),
  content: text('Content').notNull(),
  createdAt: timestamp('CreatedAt', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('UpdatedAt', { withTimezone: true }).defaultNow().notNull(),
  status: varchar('Status', { length: 20 }).default('Permanent').notNull(),
  source: varchar('Source', { length: 20 }),
  enrichmentJson: text('EnrichmentJson'),
  enrichStatus: varchar('EnrichStatus', { length: 20 }).default('None').notNull(),
  enrichRetryCount: integer('EnrichRetryCount').default(0).notNull(),
  // Embedding stored as real[] in PG; vector ops use raw SQL
  embedStatus: varchar('EmbedStatus', { length: 20 }).default('Pending').notNull(),
  embedRetryCount: integer('EmbedRetryCount').default(0).notNull(),
  embedError: text('EmbedError'),
  embedUpdatedAt: timestamp('EmbedUpdatedAt', { withTimezone: true }),
  embeddingModel: varchar('EmbeddingModel', { length: 100 }),
  noteType: varchar('NoteType', { length: 20 }).default('Regular').notNull(),
  sourceAuthor: text('SourceAuthor'),
  sourceTitle: text('SourceTitle'),
  sourceUrl: text('SourceUrl'),
  sourceYear: integer('SourceYear'),
  sourceType: varchar('SourceType', { length: 20 }),
})

export const noteTags = pgTable('NoteTags', {
  noteId: varchar('NoteId', { length: 21 }).notNull(),
  tag: text('Tag').notNull(),
})

export const noteVersions = pgTable('NoteVersions', {
  id: integer('Id').primaryKey().generatedByDefaultAsIdentity(),
  noteId: varchar('NoteId', { length: 21 }).notNull(),
  title: text('Title').notNull(),
  content: text('Content').notNull(),
  tags: text('Tags'),
  savedAt: timestamp('SavedAt', { withTimezone: true }).defaultNow().notNull(),
})

// ── Content generation ────────────────────────────────────────────────────────

export const contentGenerations = pgTable('ContentGenerations', {
  id: varchar('Id', { length: 21 }).primaryKey(),
  seedNoteId: varchar('SeedNoteId', { length: 21 }).notNull(),
  clusterNoteIds: text('ClusterNoteIds').notNull().default('[]'), // jsonb stored as text
  topicSummary: text('TopicSummary').notNull(),
  // TopicEmbedding: vector, raw SQL only
  status: varchar('Status', { length: 20 }).default('Pending').notNull(),
  generatedAt: timestamp('GeneratedAt', { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp('ReviewedAt', { withTimezone: true }),
})

export const contentPieces = pgTable('ContentPieces', {
  id: varchar('Id', { length: 21 }).primaryKey(),
  generationId: varchar('GenerationId', { length: 21 }).notNull(),
  medium: varchar('Medium', { length: 20 }).notNull(),
  body: text('Body').notNull(),
  description: text('Description'),
  generatedTags: text('GeneratedTags').notNull().default('[]'), // jsonb stored as text
  status: varchar('Status', { length: 20 }).default('Draft').notNull(),
  createdAt: timestamp('CreatedAt', { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp('ReviewedAt', { withTimezone: true }),
})

export const usedSeedNotes = pgTable('UsedSeedNotes', {
  noteId: varchar('NoteId', { length: 21 }).primaryKey(),
  usedAt: timestamp('UsedAt', { withTimezone: true }).defaultNow().notNull(),
})

// ── Voice ─────────────────────────────────────────────────────────────────────

export const voiceExamples = pgTable('VoiceExamples', {
  id: varchar('Id', { length: 21 }).primaryKey(),
  medium: varchar('Medium', { length: 20 }).notNull(),
  content: text('Content').notNull(),
  createdAt: timestamp('CreatedAt', { withTimezone: true }).defaultNow().notNull(),
})

export const voiceConfigs = pgTable('VoiceConfigs', {
  id: varchar('Id', { length: 21 }).primaryKey(),
  medium: varchar('Medium', { length: 20 }).notNull(),
  toneDescription: text('ToneDescription'),
  audienceDescription: text('AudienceDescription'),
  updatedAt: timestamp('UpdatedAt', { withTimezone: true }).defaultNow().notNull(),
})

// ── Research ──────────────────────────────────────────────────────────────────

export const researchAgendas = pgTable('ResearchAgendas', {
  id: varchar('Id', { length: 21 }).primaryKey(),
  triggeredFromNoteId: varchar('TriggeredFromNoteId', { length: 21 }),
  status: varchar('Status', { length: 20 }).default('Pending').notNull(),
  createdAt: timestamp('CreatedAt', { withTimezone: true }).defaultNow().notNull(),
  approvedAt: timestamp('ApprovedAt', { withTimezone: true }),
})

export const researchTasks = pgTable('ResearchTasks', {
  id: varchar('Id', { length: 21 }).primaryKey(),
  agendaId: varchar('AgendaId', { length: 21 }).notNull(),
  query: text('Query').notNull(),
  sourceType: varchar('SourceType', { length: 20 }).notNull(),
  motivation: text('Motivation').notNull(),
  motivationNoteId: varchar('MotivationNoteId', { length: 21 }),
  status: varchar('Status', { length: 20 }).default('Pending').notNull(),
  blockedAt: timestamp('BlockedAt', { withTimezone: true }),
})

export const researchFindings = pgTable('ResearchFindings', {
  id: varchar('Id', { length: 21 }).primaryKey(),
  taskId: varchar('TaskId', { length: 21 }).notNull(),
  title: text('Title').notNull(),
  synthesis: text('Synthesis').notNull(),
  sourceUrl: text('SourceUrl').notNull(),
  sourceType: varchar('SourceType', { length: 20 }).notNull(),
  similarNoteIds: text('SimilarNoteIds').notNull().default('[]'), // jsonb
  duplicateSimilarity: doublePrecision('DuplicateSimilarity'),
  status: varchar('Status', { length: 20 }).default('Pending').notNull(),
  acceptedFleetingNoteId: varchar('AcceptedFleetingNoteId', { length: 21 }),
  createdAt: timestamp('CreatedAt', { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp('ReviewedAt', { withTimezone: true }),
})
