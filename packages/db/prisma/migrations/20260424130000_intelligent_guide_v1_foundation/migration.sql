-- Intelligent Guide v1 — Sprint 1 schema foundation.
--
-- Six additive schema changes + one new table, all backed by the
-- Intelligent_Guide_Requirements.md spec (§8.4 Schema additions). All
-- defaults preserve existing row behavior; no data migration beyond the
-- journey-progress wipe at the end (safe pre-launch).
--
-- 1. Table.isDemo                 — Hook demo tables (§5.1)
-- 2. Game.isSpar                  — persisted spar matches (§5.2)
-- 3. Tournament.isCup             — Curriculum Cup + Rookie Cup (§5.4 / §5.8)
-- 4. Tournament.seedingMode       — deterministic bracket seeding (§5.9)
-- 5. TournamentTemplate.seedingMode  — template-level seeding toggle
-- 6. User.isTestUser              — metrics pollution prevention (§2)
-- 7. metrics_snapshots table      — daily aggregated dashboard metrics (§2)
-- 8. Wipe existing journeyProgress preferences — new 7-step spec has
--    incompatible trigger semantics; pre-launch so no real data to preserve.

-- ── 1-2. Table.isDemo + Game.isSpar ────────────────────────────────
ALTER TABLE "tables" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "games"  ADD COLUMN "isSpar" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "tables_isDemo_idx" ON "tables"("isDemo");
CREATE INDEX "games_isSpar_idx"  ON "games"("isSpar");

-- ── 3-4. Tournament.isCup + seedingMode ────────────────────────────
CREATE TYPE "TournamentSeedingMode" AS ENUM ('random', 'deterministic');

ALTER TABLE "tournaments" ADD COLUMN "isCup"        BOOLEAN                 NOT NULL DEFAULT false;
ALTER TABLE "tournaments" ADD COLUMN "seedingMode"  "TournamentSeedingMode" NOT NULL DEFAULT 'random';

CREATE INDEX "tournaments_isCup_idx" ON "tournaments"("isCup");

-- ── 5. TournamentTemplate.seedingMode ──────────────────────────────
ALTER TABLE "tournament_templates" ADD COLUMN "seedingMode" "TournamentSeedingMode" NOT NULL DEFAULT 'random';

-- ── 6. User.isTestUser ─────────────────────────────────────────────
-- Excludes internal / admin / QA / dev accounts from all metrics aggregations.
-- Set true on creation for admins, seed accounts, and internal email domains;
-- admins can opt in via "Include my activity in platform dashboards" toggle
-- which flips this back to false for their own account.
ALTER TABLE "users" ADD COLUMN "isTestUser" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "users_isTestUser_idx" ON "users"("isTestUser");

-- ── 7. metrics_snapshots table ─────────────────────────────────────
-- Daily aggregate snapshot emitted by a UTC-midnight cron. The dashboard
-- reads this table for historical trend metrics; live metrics query raw
-- event tables directly. Aggregates exclude isTestUser=true rows.
CREATE TABLE "metrics_snapshots" (
    "id"         TEXT         NOT NULL,
    "date"       DATE         NOT NULL,
    "metric"     TEXT         NOT NULL,
    "value"      DOUBLE PRECISION NOT NULL,
    "dimensions" JSONB        NOT NULL DEFAULT '{}',
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "metrics_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "metrics_snapshots_date_metric_idx"
    ON "metrics_snapshots"("date", "metric", ((dimensions::text)));
CREATE INDEX        "metrics_snapshots_date_idx"       ON "metrics_snapshots"("date");
CREATE INDEX        "metrics_snapshots_metric_idx"     ON "metrics_snapshots"("metric");

-- ── 8. Wipe existing journeyProgress ───────────────────────────────
-- The 7-step spec redefines each step's meaning and triggers. Preserving
-- old progress would give users partial-credit against new steps that
-- measure different activity. Safe pre-launch; no production users yet.
--
-- Preserves all OTHER user preferences (guideSlots, notification prefs,
-- etc.) — surgically drops only journeyProgress.
UPDATE "users"
   SET "preferences" = ("preferences" - 'journeyProgress')
 WHERE "preferences" ? 'journeyProgress';
