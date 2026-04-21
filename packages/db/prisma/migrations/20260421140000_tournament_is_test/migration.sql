-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN     "isTest" BOOLEAN NOT NULL DEFAULT false;

-- Retrofit: flag existing automated-test tournaments so they stop polluting
-- the public list the moment the server restarts. E2E suite names start with
-- "E2E " and descriptions either contain "Automated MIXED tournament QA"
-- (tournament-mixed.spec.js) or "UI smoke" (tournament-mixed-ui.spec.js).
UPDATE "tournaments"
   SET "isTest" = true
 WHERE "name" LIKE 'E2E %'
    OR "description" LIKE '%Automated MIXED tournament QA%'
    OR "description" LIKE '%UI smoke%';
