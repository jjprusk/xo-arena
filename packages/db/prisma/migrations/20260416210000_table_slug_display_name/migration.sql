-- Phase 3.4: Add slug and displayName to Table for room-join-by-URL flow.
-- slug is unique (only one active table per mountain name at a time).

ALTER TABLE "tables" ADD COLUMN "slug" TEXT;
ALTER TABLE "tables" ADD COLUMN "displayName" TEXT;

CREATE UNIQUE INDEX "tables_slug_key" ON "tables"("slug");
