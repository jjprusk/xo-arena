-- Drop tables.displayName: UI labels are now computed on read from seats +
-- tournament context (see backend/src/lib/tableLabel.js). The slug column
-- (still unique) survives so existing URLs continue to resolve.
ALTER TABLE "tables" DROP COLUMN "displayName";
