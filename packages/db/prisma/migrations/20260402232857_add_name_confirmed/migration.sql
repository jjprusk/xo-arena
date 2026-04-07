-- AlterTable
ALTER TABLE "users" ADD COLUMN     "nameConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: existing users have already chosen or accepted their name
UPDATE "users" SET "nameConfirmed" = true WHERE "betterAuthId" IS NOT NULL OR "clerkId" IS NOT NULL;
