ALTER TABLE "SavedRecipient"
ADD COLUMN "lastFailureReason" VARCHAR(500),
ADD COLUMN "lastFailureAt" TIMESTAMP(3);
