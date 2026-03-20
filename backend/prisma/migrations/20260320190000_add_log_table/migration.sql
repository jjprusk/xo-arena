CREATE TABLE "logs" (
  "id"        TEXT NOT NULL,
  "level"     TEXT NOT NULL,
  "source"    TEXT NOT NULL,
  "message"   TEXT NOT NULL,
  "userId"    TEXT,
  "sessionId" TEXT,
  "roomId"    TEXT,
  "meta"      JSONB,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "logs_timestamp_idx" ON "logs"("timestamp");
CREATE INDEX "logs_level_idx"     ON "logs"("level");
CREATE INDEX "logs_source_idx"    ON "logs"("source");
