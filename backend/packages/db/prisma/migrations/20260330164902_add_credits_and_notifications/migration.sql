-- AlterTable
ALTER TABLE "users" ADD COLUMN     "creditsBpc" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "creditsHpc" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "creditsTc" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "user_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_notifications_userId_deliveredAt_idx" ON "user_notifications"("userId", "deliveredAt");

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
