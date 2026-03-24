-- Zettel database schema — SQLite / Cloudflare D1
-- Vectors stored in Cloudflare Vectorize (not D1).

-- ── Notes ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Notes" (
  "Id"              TEXT PRIMARY KEY,
  "Title"           TEXT NOT NULL,
  "Content"         TEXT NOT NULL,
  "CreatedAt"       TEXT NOT NULL DEFAULT (datetime('now')),
  "UpdatedAt"       TEXT NOT NULL DEFAULT (datetime('now')),
  "Status"          TEXT NOT NULL DEFAULT 'Permanent',
  "Source"          TEXT,
  "EnrichmentJson"  TEXT,
  "EnrichStatus"    TEXT NOT NULL DEFAULT 'None',
  "EnrichRetryCount" INTEGER NOT NULL DEFAULT 0,
  "EmbedStatus"     TEXT NOT NULL DEFAULT 'Pending',
  "EmbedRetryCount" INTEGER NOT NULL DEFAULT 0,
  "EmbedError"      TEXT,
  "EmbedUpdatedAt"  TEXT,
  "EmbeddingModel"  TEXT,
  "NoteType"        TEXT NOT NULL DEFAULT 'Regular',
  "SourceAuthor"    TEXT,
  "SourceTitle"     TEXT,
  "SourceUrl"       TEXT,
  "SourceYear"      INTEGER,
  "SourceType"      TEXT
);

CREATE TABLE IF NOT EXISTS "NoteTags" (
  "NoteId"  TEXT NOT NULL REFERENCES "Notes"("Id") ON DELETE CASCADE,
  "Tag"     TEXT NOT NULL,
  PRIMARY KEY ("NoteId", "Tag")
);

CREATE TABLE IF NOT EXISTS "NoteVersions" (
  "Id"       INTEGER PRIMARY KEY AUTOINCREMENT,
  "NoteId"   TEXT NOT NULL REFERENCES "Notes"("Id") ON DELETE CASCADE,
  "Title"    TEXT NOT NULL,
  "Content"  TEXT NOT NULL,
  "Tags"     TEXT,
  "SavedAt"  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_status     ON "Notes"("Status");
CREATE INDEX IF NOT EXISTS idx_notes_notetype   ON "Notes"("NoteType");
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON "Notes"("CreatedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_notetags_tag     ON "NoteTags"("Tag");
CREATE INDEX IF NOT EXISTS idx_noteversions_noteid ON "NoteVersions"("NoteId");

CREATE INDEX IF NOT EXISTS idx_notes_embed_status ON "Notes"("EmbedStatus");
CREATE INDEX IF NOT EXISTS idx_notes_enrich_status ON "Notes"("EnrichStatus");

-- FTS5 full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  Id UNINDEXED,
  Title,
  Content,
  content='Notes',
  content_rowid='rowid'
);

-- Triggers to keep FTS5 in sync with Notes table
CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON "Notes" BEGIN
  INSERT INTO notes_fts(rowid, Id, Title, Content)
  VALUES (new.rowid, new."Id", new."Title", new."Content");
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON "Notes" BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, Id, Title, Content)
  VALUES ('delete', old.rowid, old."Id", old."Title", old."Content");
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE ON "Notes" BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, Id, Title, Content)
  VALUES ('delete', old.rowid, old."Id", old."Title", old."Content");
  INSERT INTO notes_fts(rowid, Id, Title, Content)
  VALUES (new.rowid, new."Id", new."Title", new."Content");
END;

-- ── Content generation ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ContentGenerations" (
  "Id"             TEXT PRIMARY KEY,
  "SeedNoteId"     TEXT NOT NULL,
  "ClusterNoteIds" TEXT NOT NULL DEFAULT '[]',
  "TopicSummary"   TEXT NOT NULL,
  "Status"         TEXT NOT NULL DEFAULT 'Pending',
  "GeneratedAt"    TEXT NOT NULL DEFAULT (datetime('now')),
  "ReviewedAt"     TEXT
);

CREATE TABLE IF NOT EXISTS "ContentPieces" (
  "Id"            TEXT PRIMARY KEY,
  "GenerationId"  TEXT NOT NULL REFERENCES "ContentGenerations"("Id") ON DELETE CASCADE,
  "Medium"        TEXT NOT NULL,
  "Body"          TEXT NOT NULL,
  "Description"   TEXT,
  "GeneratedTags" TEXT NOT NULL DEFAULT '[]',
  "Status"        TEXT NOT NULL DEFAULT 'Draft',
  "CreatedAt"     TEXT NOT NULL DEFAULT (datetime('now')),
  "ReviewedAt"    TEXT
);

CREATE INDEX IF NOT EXISTS idx_contentpieces_generationid ON "ContentPieces"("GenerationId");
CREATE INDEX IF NOT EXISTS idx_contentpieces_status       ON "ContentPieces"("Status");

CREATE TABLE IF NOT EXISTS "UsedSeedNotes" (
  "NoteId"  TEXT PRIMARY KEY,
  "UsedAt"  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── App settings (key-value) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AppSettings" (
  "Key"   TEXT PRIMARY KEY,
  "Value" TEXT NOT NULL
);

-- Seed default LLM settings
INSERT OR IGNORE INTO "AppSettings" ("Key", "Value") VALUES ('llm:provider', 'openrouter');
INSERT OR IGNORE INTO "AppSettings" ("Key", "Value") VALUES ('llm:model', 'openai/gpt-4o');

-- ── Voice ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "VoiceExamples" (
  "Id"        TEXT PRIMARY KEY,
  "Medium"    TEXT NOT NULL,
  "Content"   TEXT NOT NULL,
  "CreatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_voiceexamples_medium ON "VoiceExamples"("Medium");

CREATE TABLE IF NOT EXISTS "VoiceConfigs" (
  "Id"                   TEXT PRIMARY KEY,
  "Medium"               TEXT NOT NULL,
  "ToneDescription"      TEXT,
  "AudienceDescription"  TEXT,
  "UpdatedAt"            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_voiceconfigs_medium ON "VoiceConfigs"("Medium");

-- ── Research ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ResearchAgendas" (
  "Id"                  TEXT PRIMARY KEY,
  "TriggeredFromNoteId" TEXT,
  "Status"              TEXT NOT NULL DEFAULT 'Pending',
  "CreatedAt"           TEXT NOT NULL DEFAULT (datetime('now')),
  "ApprovedAt"          TEXT
);

CREATE TABLE IF NOT EXISTS "ResearchTasks" (
  "Id"               TEXT PRIMARY KEY,
  "AgendaId"         TEXT NOT NULL REFERENCES "ResearchAgendas"("Id") ON DELETE CASCADE,
  "Query"            TEXT NOT NULL,
  "SourceType"       TEXT NOT NULL,
  "Motivation"       TEXT NOT NULL,
  "MotivationNoteId" TEXT,
  "Status"           TEXT NOT NULL DEFAULT 'Pending',
  "BlockedAt"        TEXT
);

CREATE INDEX IF NOT EXISTS idx_researchtasks_agendaid ON "ResearchTasks"("AgendaId");

CREATE TABLE IF NOT EXISTS "ResearchFindings" (
  "Id"                    TEXT PRIMARY KEY,
  "TaskId"                TEXT NOT NULL REFERENCES "ResearchTasks"("Id"),
  "Title"                 TEXT NOT NULL,
  "Synthesis"             TEXT NOT NULL,
  "SourceUrl"             TEXT NOT NULL,
  "SourceType"            TEXT NOT NULL,
  "SimilarNoteIds"        TEXT NOT NULL DEFAULT '[]',
  "DuplicateSimilarity"   REAL,
  "Status"                TEXT NOT NULL DEFAULT 'Pending',
  "AcceptedFleetingNoteId" TEXT,
  "CreatedAt"             TEXT NOT NULL DEFAULT (datetime('now')),
  "ReviewedAt"            TEXT
);

CREATE INDEX IF NOT EXISTS idx_researchfindings_taskid ON "ResearchFindings"("TaskId");
CREATE INDEX IF NOT EXISTS idx_researchfindings_status ON "ResearchFindings"("Status", "CreatedAt" DESC);
