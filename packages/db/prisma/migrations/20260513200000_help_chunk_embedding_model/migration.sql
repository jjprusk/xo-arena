-- Adds `embeddingModel` to help_chunks so the boot-time auto-reindex check
-- (Sprint 2 §2.1 — see Help_System_Plan.md ADR-001) can detect rows that
-- were embedded under a different model and reindex them once.
--
-- Existing rows (Sprint 1) were embedded with the deterministic hash-projection
-- stub. They get the sentinel value 'stub' so the first boot under Sprint 2's
-- OpenAI client re-embeds them via reindexAll().
--
-- Sprint 2's OpenAI embeds will write 'text-embedding-3-small@384'.

ALTER TABLE "help_chunks"
  ADD COLUMN "embeddingModel" TEXT NOT NULL DEFAULT 'stub';

CREATE INDEX "help_chunks_embeddingModel_idx" ON "help_chunks"("embeddingModel");
