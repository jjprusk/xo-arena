-- Adds curation review stamps to help_answers (Sprint 4 §4.2). The
-- curation queue UI (§4.1) lets HELP_ADMIN mark an answer as reviewed,
-- which sets `reviewedAt = now()` + `reviewedById = <admin.User.id>`.
-- Index supports "unreviewed filter-triggered in last 24h" queries.

ALTER TABLE "help_answers"
  ADD COLUMN "reviewedAt"    TIMESTAMP(3),
  ADD COLUMN "reviewedById"  TEXT;

CREATE INDEX "help_answers_reviewedAt_idx"
  ON "help_answers"("reviewedAt");
