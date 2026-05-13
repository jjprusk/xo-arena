-- Learnable Help System — Sprint 1 foundation.
--
-- Adds the pgvector extension, the HELP_ADMIN role enum value, and the five
-- Help models that anchor the RAG pipeline:
--   help_docs       — canonical articles (DB-canonical after corpus seed)
--   help_chunks     — chunked rows with FTS tsvector + 384-dim pgvector
--   help_queries    — every /ask call, retrieval signals, context blob
--   help_answers    — generated answers, with content-filter flags
--   help_feedback   — explicit + implicit user feedback, upsert-shaped
--
-- See doc/Help_System_Plan.md for the architectural rationale behind each
-- column. The pgvector ivfflat index uses lists=100 — adequate for the
-- expected v1 corpus size (~15 docs × ~5 chunks). Re-tune via REINDEX once
-- corpus grows past ~10k chunks.

-- ── pgvector extension ────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Role enum extension ───────────────────────────────────────────
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'HELP_ADMIN';

-- ── HelpDocStatus / HelpFeedbackSignal / HelpFeedbackCategory ─────
CREATE TYPE "HelpDocStatus"        AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "HelpFeedbackSignal"   AS ENUM ('HELPFUL', 'NOT_HELPFUL');
CREATE TYPE "HelpFeedbackCategory" AS ENUM ('OFF_TOPIC', 'OUTDATED', 'WRONG', 'INCOMPLETE');

-- ── help_docs ─────────────────────────────────────────────────────
CREATE TABLE "help_docs" (
    "id"             TEXT            NOT NULL,
    "slug"           TEXT            NOT NULL,
    "title"          TEXT            NOT NULL,
    "body"           TEXT            NOT NULL,
    "category"       TEXT            NOT NULL,
    "tags"           TEXT[]          NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status"         "HelpDocStatus" NOT NULL DEFAULT 'PUBLISHED',
    "authorId"       TEXT,
    "lastEditedById" TEXT,
    "version"        INTEGER         NOT NULL DEFAULT 1,
    "seededFromFile" TEXT,
    "createdAt"      TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)    NOT NULL,
    CONSTRAINT "help_docs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "help_docs_slug_key"     ON "help_docs"("slug");
CREATE INDEX        "help_docs_status_idx"   ON "help_docs"("status");
CREATE INDEX        "help_docs_category_idx" ON "help_docs"("category");

-- ── help_chunks ───────────────────────────────────────────────────
-- tsv is maintained by trigger so we don't need to recompute on every read.
-- embedding is pgvector(384) — matches MiniLM-L6-v2 output dim.
CREATE TABLE "help_chunks" (
    "id"         TEXT          NOT NULL,
    "docId"      TEXT          NOT NULL,
    "position"   INTEGER       NOT NULL,
    "content"    TEXT          NOT NULL,
    "tsv"        tsvector,
    "embedding"  vector(384),
    "docVersion" INTEGER       NOT NULL,
    "createdAt"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "help_chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "help_chunks_docId_fkey" FOREIGN KEY ("docId") REFERENCES "help_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "help_chunks_docId_idx"     ON "help_chunks"("docId");
CREATE INDEX "help_chunks_tsv_idx"       ON "help_chunks" USING GIN ("tsv");
CREATE INDEX "help_chunks_embedding_idx" ON "help_chunks" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- Trigger to keep tsv in sync with content. We index against English config;
-- if multilingual support is ever added, fork this trigger by docId.category.
CREATE FUNCTION help_chunks_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER help_chunks_tsv_update
  BEFORE INSERT OR UPDATE OF content ON "help_chunks"
  FOR EACH ROW EXECUTE FUNCTION help_chunks_tsv_trigger();

-- ── help_queries ──────────────────────────────────────────────────
CREATE TABLE "help_queries" (
    "id"                TEXT          NOT NULL,
    "userId"            TEXT,
    "text"              TEXT          NOT NULL,
    "textTsv"           tsvector,
    "embedding"         vector(384),
    "retrievedChunkIds" TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
    "retrievalScore"    JSONB         NOT NULL DEFAULT '{}'::JSONB,
    "topAnswerId"       TEXT,
    "context"           JSONB         NOT NULL DEFAULT '{}'::JSONB,
    "promptTemplate"    TEXT,
    "modelVersion"      TEXT,
    "latencyMs"         INTEGER,
    "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "help_queries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "help_queries_userId_idx"    ON "help_queries"("userId");
CREATE INDEX "help_queries_createdAt_idx" ON "help_queries"("createdAt");

CREATE FUNCTION help_queries_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW."textTsv" := to_tsvector('english', COALESCE(NEW.text, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER help_queries_tsv_update
  BEFORE INSERT OR UPDATE OF text ON "help_queries"
  FOR EACH ROW EXECUTE FUNCTION help_queries_tsv_trigger();

-- ── help_answers ──────────────────────────────────────────────────
CREATE TABLE "help_answers" (
    "id"                     TEXT          NOT NULL,
    "queryId"                TEXT          NOT NULL,
    "chunkIds"               TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
    "rendered"               TEXT          NOT NULL,
    "rank"                   INTEGER       NOT NULL DEFAULT 0,
    "tokensIn"               INTEGER,
    "tokensOut"              INTEGER,
    "stopReason"             TEXT,
    "contentFilterTriggered" BOOLEAN       NOT NULL DEFAULT false,
    "contentFilterTerms"     TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt"              TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "help_answers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "help_answers_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "help_queries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "help_answers_queryId_idx" ON "help_answers"("queryId");

-- ── help_feedback ─────────────────────────────────────────────────
CREATE TABLE "help_feedback" (
    "id"        TEXT                   NOT NULL,
    "userId"    TEXT                   NOT NULL,
    "queryId"   TEXT                   NOT NULL,
    "answerId"  TEXT                   NOT NULL,
    "signal"    "HelpFeedbackSignal",
    "category"  "HelpFeedbackCategory",
    "comment"   TEXT,
    "implicit"  JSONB                  NOT NULL DEFAULT '{}'::JSONB,
    "createdAt" TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3)           NOT NULL,
    CONSTRAINT "help_feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "help_feedback_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "help_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "help_feedback_userId_queryId_answerId_key" ON "help_feedback"("userId", "queryId", "answerId");
CREATE INDEX        "help_feedback_answerId_idx"                ON "help_feedback"("answerId");
