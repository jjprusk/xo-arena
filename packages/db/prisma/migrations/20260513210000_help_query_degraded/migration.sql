-- Adds `degraded` + `degradedReason` to help_queries. Set by
-- helpService.search when embedding generation fails and retrieval falls
-- back to the tsv-only path (Sprint 2 §2.2). Surfaced in admin Health
-- dashboard as the degraded-rate-over-1h/24h tile.

ALTER TABLE "help_queries"
  ADD COLUMN "degraded"       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "degradedReason" TEXT;

CREATE INDEX "help_queries_degraded_createdAt_idx"
  ON "help_queries"("degraded", "createdAt");
