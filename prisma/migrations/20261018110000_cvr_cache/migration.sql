-- CreateTable
CREATE TABLE "CvrLookupCache" (
    "cvr" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CvrLookupCache_pkey" PRIMARY KEY ("cvr")
);

-- CreateIndex
CREATE INDEX "CvrLookupCache_expiresAt_idx" ON "CvrLookupCache"("expiresAt");

