-- Remove the unused ACTIVE value from ParticipantStatus.
-- ACTIVE was never written by the application (only REGISTERED, ELIMINATED, WITHDRAWN are used).
-- We convert any residual ACTIVE rows to REGISTERED as a safety net.

-- Step 1: Drop column default so the enum type can be dropped
ALTER TABLE "tournament_participants" ALTER COLUMN "status" DROP DEFAULT;

-- Step 2: Convert column to text so we can drop the enum
ALTER TABLE "tournament_participants" ALTER COLUMN "status" TYPE text;

-- Step 3: Drop old enum
DROP TYPE "ParticipantStatus";

-- Step 4: Convert any ACTIVE rows to REGISTERED (safety net — should be 0 rows)
UPDATE "tournament_participants" SET "status" = 'REGISTERED' WHERE "status" = 'ACTIVE';

-- Step 5: Create new enum without ACTIVE
CREATE TYPE "ParticipantStatus" AS ENUM ('REGISTERED', 'ELIMINATED', 'WITHDRAWN');

-- Step 6: Re-apply enum type and restore default
ALTER TABLE "tournament_participants"
  ALTER COLUMN "status" TYPE "ParticipantStatus" USING "status"::"ParticipantStatus",
  ALTER COLUMN "status" SET DEFAULT 'REGISTERED';
