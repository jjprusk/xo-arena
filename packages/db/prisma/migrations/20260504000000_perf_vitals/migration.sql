-- CreateTable
CREATE TABLE "perf_vitals" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "env" TEXT,
    "releaseVersion" TEXT,
    "sessionId" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "rating" TEXT,
    "navigationType" TEXT,
    "deviceClass" TEXT,
    "effectiveType" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "perf_vitals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "perf_vitals_name_route_createdAt_idx" ON "perf_vitals"("name", "route", "createdAt");

-- CreateIndex
CREATE INDEX "perf_vitals_env_name_createdAt_idx" ON "perf_vitals"("env", "name", "createdAt");
