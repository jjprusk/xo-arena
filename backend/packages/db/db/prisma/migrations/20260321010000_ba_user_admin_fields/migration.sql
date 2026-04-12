ALTER TABLE "ba_users" ADD COLUMN "banned" BOOLEAN;
ALTER TABLE "ba_users" ADD COLUMN "banReason" TEXT;
ALTER TABLE "ba_users" ADD COLUMN "banExpires" TIMESTAMP(3);
