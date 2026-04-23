-- Template-level registration window for the next occurrence. Both
-- advance alongside recurrenceStart each time the scheduler spawns.
-- Nullable — existing rows get the current behaviour (open = spawn, close = startTime).

ALTER TABLE "tournament_templates"
  ADD COLUMN "registrationOpenAt"  TIMESTAMP(3),
  ADD COLUMN "registrationCloseAt" TIMESTAMP(3);
