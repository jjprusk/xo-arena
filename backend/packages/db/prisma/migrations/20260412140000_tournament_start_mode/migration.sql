-- CreateEnum
CREATE TYPE "TournamentStartMode" AS ENUM ('AUTO', 'SCHEDULED', 'MANUAL');

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN "startMode" "TournamentStartMode" NOT NULL DEFAULT 'AUTO';
