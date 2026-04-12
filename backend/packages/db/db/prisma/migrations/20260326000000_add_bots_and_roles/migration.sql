-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'BOT_ADMIN', 'TOURNAMENT_ADMIN');

-- AlterEnum: Add PVBOT game mode
ALTER TYPE "GameMode" ADD VALUE 'PVBOT';

-- AlterTable: Add bot fields, drop legacy roles array
ALTER TABLE "users" DROP COLUMN "roles",
ADD COLUMN     "botActive"       BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "botAvailable"    BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botCalibrating"  BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botCompetitive"  BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botInTournament" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botLimit"        INTEGER,
ADD COLUMN     "botModelId"      TEXT,
ADD COLUMN     "botModelType"    TEXT,
ADD COLUMN     "botOwnerId"      TEXT,
ADD COLUMN     "isBot"           BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: UserRole join table
CREATE TABLE "user_roles" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "role"        "Role" NOT NULL,
    "grantedById" TEXT NOT NULL,
    "grantedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: userId index for join table
CREATE INDEX "user_roles_userId_idx" ON "user_roles"("userId");

-- CreateIndex: unique constraint — one role entry per user per role
CREATE UNIQUE INDEX "user_roles_userId_role_key" ON "user_roles"("userId", "role");

-- CreateIndex: unique botModelId — one bot per model snapshot
CREATE UNIQUE INDEX "users_botModelId_key" ON "users"("botModelId");

-- AddForeignKey: UserRole → User
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
