-- Lightning Addresses each account paid, synced as send suggestions.
CREATE TABLE "SavedRecipient" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lightningAddress" VARCHAR(200) NOT NULL,
    "name" VARCHAR(80),
    "avatarUrl" VARCHAR(2048),
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedRecipient_userId_lightningAddress_key" ON "SavedRecipient"("userId", "lightningAddress");

CREATE INDEX "SavedRecipient_userId_lastUsedAt_idx" ON "SavedRecipient"("userId", "lastUsedAt");

ALTER TABLE "SavedRecipient" ADD CONSTRAINT "SavedRecipient_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
