-- F11.5 — Add cohort column + index for returning-vs-new user segmentation
-- in the admin Web Vitals dashboard. See doc/Performance_Plan_v2.md §F11.5.
ALTER TABLE "perf_vitals" ADD COLUMN "cohort" TEXT;
CREATE INDEX "perf_vitals_cohort_name_createdAt_idx" ON "perf_vitals"("cohort", "name", "createdAt");
