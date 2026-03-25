import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// ── Notes ─────────────────────────────────────────────────────────────────────

export const notes = sqliteTable('Notes', {
  id: text('Id').primaryKey(),
  title: text('Title').notNull(),
  content: text('Content').notNull(),
  createdAt: text('CreatedAt').notNull(), // ISO-8601 string
  updatedAt: text('UpdatedAt').notNull(),
  status: text('Status').notNull().default('Permanent'),
  source: text('Source'),
  enrichmentJson: text('EnrichmentJson'),
  enrichStatus: text('EnrichStatus').notNull().default('None'),
  enrichRetryCount: integer('EnrichRetryCount').notNull().default(0),
  // Embeddings stored in Vectorize, not D1
  embedStatus: text('EmbedStatus').notNull().default('Pending'),
  embedRetryCount: integer('EmbedRetryCount').notNull().default(0),
  embedError: text('EmbedError'),
  embedUpdatedAt: text('EmbedUpdatedAt'),
  embeddingModel: text('EmbeddingModel'),
  noteType: text('NoteType').notNull().default('Regular'),
  sourceAuthor: text('SourceAuthor'),
  sourceTitle: text('SourceTitle'),
  sourceUrl: text('SourceUrl'),
  sourceYear: integer('SourceYear'),
  sourceType: text('SourceType'),
})

export const noteTags = sqliteTable('NoteTags', {
  noteId: text('NoteId').notNull(),
  tag: text('Tag').notNull(),
})

export const noteVersions = sqliteTable('NoteVersions', {
  id: integer('Id').primaryKey({ autoIncrement: true }),
  noteId: text('NoteId').notNull(),
  title: text('Title').notNull(),
  content: text('Content').notNull(),
  tags: text('Tags'),
  savedAt: text('SavedAt').notNull(),
})

// ── Content generation ────────────────────────────────────────────────────────

export const contentGenerations = sqliteTable('ContentGenerations', {
  id: text('Id').primaryKey(),
  seedNoteId: text('SeedNoteId').notNull(),
  clusterNoteIds: text('ClusterNoteIds').notNull().default('[]'),
  topicSummary: text('TopicSummary').notNull(),
  status: text('Status').notNull().default('Pending'),
  generatedAt: text('GeneratedAt').notNull(),
  reviewedAt: text('ReviewedAt'),
})

export const contentPieces = sqliteTable('ContentPieces', {
  id: text('Id').primaryKey(),
  generationId: text('GenerationId').notNull(),
  medium: text('Medium').notNull(),
  body: text('Body').notNull(),
  description: text('Description'),
  generatedTags: text('GeneratedTags').notNull().default('[]'),
  status: text('Status').notNull().default('Draft'),
  createdAt: text('CreatedAt').notNull(),
  reviewedAt: text('ReviewedAt'),
})

export const usedSeedNotes = sqliteTable('UsedSeedNotes', {
  noteId: text('NoteId').primaryKey(),
  usedAt: text('UsedAt').notNull(),
})

// ── Voice ─────────────────────────────────────────────────────────────────────

export const voiceExamples = sqliteTable('VoiceExamples', {
  id: text('Id').primaryKey(),
  medium: text('Medium').notNull(),
  content: text('Content').notNull(),
  createdAt: text('CreatedAt').notNull(),
})

export const voiceConfigs = sqliteTable('VoiceConfigs', {
  id: text('Id').primaryKey(),
  medium: text('Medium').notNull(),
  toneDescription: text('ToneDescription'),
  audienceDescription: text('AudienceDescription'),
  updatedAt: text('UpdatedAt').notNull(),
})

// ── App settings (key-value) ─────────────────────────────────────────────────

export const appSettings = sqliteTable('AppSettings', {
  key: text('Key').primaryKey(),
  value: text('Value').notNull(),
})

// ── Blog posts (published to Cloudflare domains) ────────────────────────────

export const blogPosts = sqliteTable('BlogPosts', {
  id: text('Id').primaryKey(),
  pieceId: text('PieceId'),               // link back to ContentPiece (nullable for manual posts)
  slug: text('Slug').notNull(),
  title: text('Title').notNull(),
  body: text('Body').notNull(),            // markdown
  description: text('Description'),
  tags: text('Tags').notNull().default('[]'),
  domain: text('Domain').notNull(),        // e.g. "thinkingfeeling.com"
  status: text('Status').notNull().default('published'), // published | draft | archived
  publishedAt: text('PublishedAt').notNull(),
  updatedAt: text('UpdatedAt').notNull(),
  ogImage: text('OgImage'),               // optional OG image URL
})

// ── Publish log (tracks cross-channel publishing) ───────────────────────────

export const publishLog = sqliteTable('PublishLog', {
  id: text('Id').primaryKey(),
  pieceId: text('PieceId').notNull(),
  channel: text('Channel').notNull(),      // 'blog' | 'linkedin' | 'youtube' | 'resend' | 'substack'
  status: text('Status').notNull().default('pending'), // pending | success | failed
  externalUrl: text('ExternalUrl'),        // URL of the published content
  externalId: text('ExternalId'),          // platform-specific ID
  metadata: text('Metadata'),             // JSON — extra info from the platform
  errorMessage: text('ErrorMessage'),
  publishedAt: text('PublishedAt').notNull(),
})

// ── Research ──────────────────────────────────────────────────────────────────

export const researchAgendas = sqliteTable('ResearchAgendas', {
  id: text('Id').primaryKey(),
  triggeredFromNoteId: text('TriggeredFromNoteId'),
  status: text('Status').notNull().default('Pending'),
  createdAt: text('CreatedAt').notNull(),
  approvedAt: text('ApprovedAt'),
})

export const researchTasks = sqliteTable('ResearchTasks', {
  id: text('Id').primaryKey(),
  agendaId: text('AgendaId').notNull(),
  query: text('Query').notNull(),
  sourceType: text('SourceType').notNull(),
  motivation: text('Motivation').notNull(),
  motivationNoteId: text('MotivationNoteId'),
  status: text('Status').notNull().default('Pending'),
  blockedAt: text('BlockedAt'),
})

export const researchFindings = sqliteTable('ResearchFindings', {
  id: text('Id').primaryKey(),
  taskId: text('TaskId').notNull(),
  title: text('Title').notNull(),
  synthesis: text('Synthesis').notNull(),
  sourceUrl: text('SourceUrl').notNull(),
  sourceType: text('SourceType').notNull(),
  similarNoteIds: text('SimilarNoteIds').notNull().default('[]'),
  duplicateSimilarity: real('DuplicateSimilarity'),
  status: text('Status').notNull().default('Pending'),
  acceptedFleetingNoteId: text('AcceptedFleetingNoteId'),
  createdAt: text('CreatedAt').notNull(),
  reviewedAt: text('ReviewedAt'),
})
