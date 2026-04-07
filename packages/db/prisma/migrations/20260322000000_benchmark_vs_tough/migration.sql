-- Add vsTough column to benchmark results (nullable for existing rows)
ALTER TABLE "ml_benchmark_results" ADD COLUMN "vsTough" JSONB;
