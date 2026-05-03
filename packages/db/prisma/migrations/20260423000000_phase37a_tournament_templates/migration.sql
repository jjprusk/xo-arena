-- Phase 3.7a — Tournament templates vs occurrences split.
--
-- Splits recurrence *configuration* (now on tournament_templates) from
-- runtime state (stays on tournaments). Existing isRecurring=true rows
-- are preserved: each produces one template row (reusing the same id
-- so recurring_tournament_registrations.templateId doesn't need
-- repointing) AND stays in tournaments as the first-run occurrence
-- with tournaments.templateId = its own id.
--
-- ORDERING: the recurring_tournament_registrations FK is added at the
-- end (after the backfill), because existing rows hold templateId
-- values that would otherwise fail the fresh FK's existence check.
-- All other FKs are safe to add early — their source tables are
-- freshly-created or nullable-empty.

-- ── 1. Schema additions ─────────────────────────────────────────────────────

ALTER TABLE "tournaments" ADD COLUMN "templateId" TEXT;

CREATE TABLE "tournament_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "game" TEXT NOT NULL,
    "mode" "TournamentMode" NOT NULL,
    "format" "TournamentFormat" NOT NULL,
    "bracketType" "BracketType" NOT NULL,
    "minParticipants" INTEGER NOT NULL DEFAULT 2,
    "maxParticipants" INTEGER,
    "bestOfN" INTEGER NOT NULL DEFAULT 3,
    "botMinGamesPlayed" INTEGER,
    "allowNonCompetitiveBots" BOOLEAN NOT NULL DEFAULT false,
    "allowSpectators" BOOLEAN NOT NULL DEFAULT true,
    "noticePeriodMinutes" INTEGER,
    "durationMinutes" INTEGER,
    "pace_ms" INTEGER,
    "startMode" "TournamentStartMode" NOT NULL DEFAULT 'AUTO',
    "recurrenceInterval" "RecurrenceInterval" NOT NULL,
    "recurrenceStart" TIMESTAMP(3) NOT NULL,
    "recurrenceEndDate" TIMESTAMP(3),
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "autoOptOutAfterMissed" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tournament_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tournament_template_seed_bots" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_template_seed_bots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tournament_templates_game_idx" ON "tournament_templates"("game");
CREATE INDEX "tournament_templates_createdById_idx" ON "tournament_templates"("createdById");
CREATE INDEX "tournament_templates_paused_recurrenceStart_idx" ON "tournament_templates"("paused", "recurrenceStart");
CREATE INDEX "tournament_template_seed_bots_templateId_idx" ON "tournament_template_seed_bots"("templateId");
CREATE UNIQUE INDEX "tournament_template_seed_bots_templateId_userId_key" ON "tournament_template_seed_bots"("templateId", "userId");
CREATE INDEX "tournaments_templateId_idx" ON "tournaments"("templateId");

-- Safe FKs (target tables freshly created — no existing rows to validate)
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "tournament_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tournament_template_seed_bots" ADD CONSTRAINT "tournament_template_seed_bots_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "tournament_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_template_seed_bots" ADD CONSTRAINT "tournament_template_seed_bots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 2. Data backfill ────────────────────────────────────────────────────────
-- Populate tournament_templates from existing recurring Tournament rows.

-- Create a template row for every existing recurring Tournament, reusing the
-- Tournament's id so recurring_tournament_registrations.templateId (pointing
-- at Tournament.id today) doesn't need updating.
INSERT INTO tournament_templates (
  id, name, description, game, mode, format, "bracketType",
  "minParticipants", "maxParticipants", "bestOfN",
  "botMinGamesPlayed", "allowNonCompetitiveBots", "allowSpectators",
  "noticePeriodMinutes", "durationMinutes", "pace_ms", "startMode",
  "recurrenceInterval", "recurrenceStart", "recurrenceEndDate",
  paused, "autoOptOutAfterMissed",
  "createdById", "createdAt", "updatedAt", "isTest"
)
SELECT
  id, name, description, game, mode, format, "bracketType",
  "minParticipants", "maxParticipants", "bestOfN",
  "botMinGamesPlayed", "allowNonCompetitiveBots", "allowSpectators",
  "noticePeriodMinutes", "durationMinutes", "pace_ms", "startMode",
  COALESCE("recurrenceInterval", 'DAILY'), "startTime", "recurrenceEndDate",
  "recurrencePaused", "autoOptOutAfterMissed",
  "createdById", "createdAt", "updatedAt", "isTest"
FROM tournaments
WHERE "isRecurring" = true
  AND "recurrenceInterval" IS NOT NULL
  AND "startTime" IS NOT NULL;

-- Point each recurring Tournament row at its freshly-minted template. The
-- Tournament row becomes an occurrence of its own template — the first one
-- to run. The scheduler spawns subsequent occurrences from now on.
UPDATE tournaments
SET "templateId" = id
WHERE "isRecurring" = true
  AND "recurrenceInterval" IS NOT NULL
  AND "startTime" IS NOT NULL;

-- Copy seed bots to the new template table. Match the same predicate as the
-- template INSERT above — a Tournament with isRecurring=true but a NULL
-- recurrenceInterval / startTime didn't produce a template, so we must skip
-- its seed bots too.
INSERT INTO tournament_template_seed_bots (id, "templateId", "userId", "createdAt")
SELECT
  sb.id || '_tmpl' AS id,
  sb."tournamentId" AS "templateId",
  sb."userId",
  sb."createdAt"
FROM tournament_seed_bots sb
JOIN tournaments t ON t.id = sb."tournamentId"
WHERE t."isRecurring" = true
  AND t."recurrenceInterval" IS NOT NULL
  AND t."startTime" IS NOT NULL;

-- ── 3. Deferred FK (now safe — templates exist for every templateId) ────────
ALTER TABLE "recurring_tournament_registrations" ADD CONSTRAINT "recurring_tournament_registrations_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "tournament_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
